import {sizePaperPosition} from './paper-risk.mjs';

const parseDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&
 Number.isFinite(Date.parse(day+'T12:00:00Z'))&&
 new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
const weeksMonday=day=>{
 const d=new Date(day+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
 return d.toISOString().slice(0,10);
};
export const PAPER_FEE=0.50;
/**
 * Safe, explainable, read-only screening of CURRENT-week paper candidates.
 * Current month's/previous historical signals must not turn into new orders.
 * No price extrapolation, fractional share, automatic order, FX inference.
 */
export function screenPaperCandidates(scanner,dashboard,{
 asOf=new Date().toISOString().slice(0,10),benchmarkDay=null,fee=PAPER_FEE
}={}){
 if(!parseDay(asOf)||!Array.isArray(scanner?.results)||
  !Number.isFinite(dashboard?.cash)||!Number.isFinite(dashboard?.equity)||
  !Number.isFinite(fee)||fee<0)throw Error('Invalid paper screening input');
 // A completed Friday can be screened immediately on Saturday/Sunday.
 // On Mon-Fri, use the prior calendar week; the current week is still open
 // to avoid trading on partial Friday data. This preserves Monday entries.
 const weekday=new Date(asOf+'T12:00:00Z').getUTCDay();
 const orderWindowOpen=weekday>=1&&weekday<=5;
 const completedMondayOffset=(weekday===0||weekday===6)?0:7;
 const previousMonday=new Date(Date.parse(weeksMonday(asOf)+'T12:00:00Z')-completedMondayOffset*86400000)
  .toISOString().slice(0,10);
 const age=day=>parseDay(day)?(Date.parse(asOf+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'))/86400000:Infinity;
 // Without a verified prior Friday candle, the prior ISO week may only
 // contain a partial Mon-Thu aggregate, which must not confirm a breakout.
 // Conservative on Friday exchange holidays until a calendar is available.
 const requiredPriorClose=new Date(Date.parse(previousMonday+'T12:00:00Z')+4*86400000)
  .toISOString().slice(0,10);
 const positions=Array.isArray(dashboard.positions)?dashboard.positions:[];
 const held=new Set(positions.map(p=>p.symbol));
 const remainingSlots=Math.max(0,4-positions.length);
 const available=Math.max(0,dashboard.cash);
 const benchmarkFresh=age(benchmarkDay)>=0&&age(benchmarkDay)<=4;
 const counts=new Map();
 for(const item of scanner.results){
  if(item?.currency==='EUR'&&typeof item.symbol==='string')
   counts.set(item.symbol,(counts.get(item.symbol)||0)+1);
 }
 const candidates=scanner.results.filter(x=>x?.currency==='EUR')
 .map(x=>{
  const reasons=[];
  if(typeof x.symbol!=='string'||!x.symbol||counts.get(x.symbol)!==1)
   reasons.push('DUPLICATE_OR_INVALID_SYMBOL');
  const last=x.last;
  const signalDay=x.asOf; // Last COMPLETED WEEK's trading date from scanWeinstein.
  const signalWeek=parseDay(signalDay)?weeksMonday(signalDay):null;
  if(!benchmarkFresh)reasons.push('BENCHMARK_STALE');
  if(!benchmarkDay||benchmarkDay<requiredPriorClose)reasons.push('PREVIOUS_WEEK_BENCHMARK_INCOMPLETE');
  if(!last||age(last.day)<0||age(last.day)>4)reasons.push('QUOTE_STALE');
  if(!last||last.day<requiredPriorClose)reasons.push('PREVIOUS_WEEK_QUOTE_INCOMPLETE');
  if(!x.eligible||x.signal!=='PHASE2_BREAKOUT')reasons.push('NO_CONFIRMED_BREAKOUT');
  if(signalWeek!==previousMonday||signalDay!==requiredPriorClose)reasons.push('SIGNAL_NOT_PREVIOUS_WEEK');
  if(held.has(x.symbol))reasons.push('ALREADY_HELD');
  if(remainingSlots<1)reasons.push('MAX_POSITIONS');
  if(!Number.isFinite(x.supportCandidate)||x.supportCandidate<=0)reasons.push('STOP_UNAVAILABLE');
  // Current quote is a last COMPLETED close, not a prediction of Monday open.
  const price=Number(last?.close);
  const stop=Number(x.supportCandidate);
  const allocation=reasons.length===0?sizePaperPosition({
   cash:available,entry:price,stop,fee,riskFraction:0.01,maxAllocationFraction:0.25
  }):null;
  if(allocation&&!allocation.eligible)reasons.push(allocation.reason);
  return {id:x.id,symbol:x.symbol,name:x.name,currency:'EUR',
   signal:x.signal,signalWeek,signalDay,quoteDay:last?.day??null,
   quotePrice:Number.isFinite(price)?price:null,stop:Number.isFinite(stop)?stop:null,
   relativeStrength:x.relativeStrength??null,volumeRatio:x.volumeRatio??null,
   watchScore:x.watchScore??null,quantity:reasons.length?0:(allocation?.quantity??0),
   maxPlannedLoss:reasons.length?null:allocation.maxPlannedLoss,
   fee,eligible:reasons.length===0,
   orderAllowed:reasons.length===0&&orderWindowOpen,
   orderReasons:!orderWindowOpen?['MARKET_CLOSED_WEEKEND']:[],reasons};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||
  (b.relativeStrength??-Infinity)-(a.relativeStrength??-Infinity)||
  String(a.symbol??'').localeCompare(String(b.symbol??'')));
 return {mode:'PAPER',asOf,initialCash:dashboard.initial,
  cash:dashboard.cash,equity:dashboard.equity,positionsOpen:positions.length,
  benchmarkDay,benchmarkFresh,signalWeekExpected:previousMonday,
  orderWindowOpen,weekendResearchOnly:!orderWindowOpen,
  eligibleCount:candidates.filter(x=>x.eligible).length,
  candidates,limitations:[
   'The indicated purchase price is the last stored completed daily CLOSE, never a live opening quote.',
   'User must explicitly confirm a fictional close-price fill on a weekday. Weekend candidates are research-only; orders are blocked.',
   'No FX conversion: USD stocks cannot be bought before reliable historical rates exist.',
   'Without a phase-2 breakout confirmed in the immediately preceding completed week, no purchase.',
   'The 1% stop risk is theoretical and may be exceeded by gaps or execution differences.'
  ]};
}
