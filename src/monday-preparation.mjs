import {scanWeinstein} from './weinstein.mjs';
import {sizePaperPosition} from './paper-risk.mjs';
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'));
const date=s=>new Date(s+'T12:00:00Z');
const daysBetween=(a,b)=>Math.round((date(b)-date(a))/86400000);
/**
 * Prepare a deterministic Monday PAPER watchlist from the preceding completed
 * weekly candle. All entries are proposals, not executed orders.
 * Inputs must be stored OHLCV series; no network calls or broker integration.
 */
export function preparePaperMonday({instruments,benchmarks,asOf,capital=500,
  maxStaleCalendarDays=5,riskFraction=.01,maxAllocationFraction=.25}){
 if(!iso(asOf)||!Array.isArray(instruments)||!benchmarks||typeof benchmarks!=='object')
  throw new Error('Invalid preparation input');
 if(!Number.isFinite(capital)||capital<=0)throw new Error('Invalid capital');
 const seen=new Set(),rows=[];
 for(const item of instruments){
  if(!item||typeof item.symbol!=='string'||seen.has(item.symbol))throw new Error('Duplicate or invalid symbol');
  seen.add(item.symbol);
  let result;
  try{
   const benchmark=benchmarks[item.currency];
   if(!Array.isArray(benchmark)||!benchmark.length)throw new Error('BENCHMARK_MISSING');
   if(!Array.isArray(item.daily)||!item.daily.length)throw new Error('HISTORY_MISSING');
   const signal=scanWeinstein(item.daily,{asOf,benchmarkDaily:benchmark});
   const latest=signal.asOf;
   if(!latest||daysBetween(latest,asOf)>maxStaleCalendarDays)
    throw new Error('STALE_MARKET_DATA');
   if(signal.signal!=='PHASE2_BREAKOUT'||!signal.eligible){
    result={symbol:item.symbol,currency:item.currency,status:'WATCH_ONLY',signal:signal.signal,
      score:signal.setupScore??0,reason:'NO_CONFIRMED_WEEKLY_BREAKOUT'};
   }else if(item.currency!=='EUR'){
    result={symbol:item.symbol,currency:item.currency,status:'BLOCKED',reason:'FX_NOT_IMPLEMENTED'};
   }else{
    const stop=signal.supportCandidate;
    const sizing=sizePaperPosition({cash:capital,entry:signal.lastCompletedClose,stop,
      riskFraction,maxAllocationFraction});
    result={symbol:item.symbol,currency:item.currency,status:sizing.eligible?'PAPER_CANDIDATE':'BLOCKED',
      signal:signal.signal,score:signal.setupScore,referenceClose:signal.lastCompletedClose,
      referenceDate:latest,stop,quantity:sizing.eligible?sizing.quantity:0,
      reason:sizing.eligible?'REQUIRES_NEXT_SESSION_ENTRY_VALIDATION':sizing.reason};
   }
  }catch(err){
   result={symbol:item.symbol,currency:item.currency,status:'BLOCKED',reason:String(err.message||err)};
  }
  rows.push(result);
 }
 const order={PAPER_CANDIDATE:0,WATCH_ONLY:1,BLOCKED:2};
 rows.sort((a,b)=>order[a.status]-order[b.status]||(b.score??0)-(a.score??0)||a.symbol.localeCompare(b.symbol));
 return {asOf,capital,universeSize:rows.length,candidates:rows.filter(x=>x.status==='PAPER_CANDIDATE').length,
  blocked:rows.filter(x=>x.status==='BLOCKED').length,rows,
  disclaimer:'PAPER only; reference Friday close is not a Monday execution price; no orders placed.'};
}
