import {aggregateWeeks} from './weinstein.mjs';
import {analyzeHistoricalPhases} from './weinstein-history.mjs';
import {sizePaperPosition,simulateLongStop} from './paper-risk.mjs';

const NEXT_WEEK=7*86400000;
const mondayAfter=week=>new Date(Date.parse(week+'T12:00:00Z')+NEXT_WEEK).toISOString().slice(0,10);
const mondayAt=asOf=>{
 const date=new Date(asOf+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(+date))throw Error('Invalid asOf');
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString().slice(0,10);
};
const round=x=>Math.round(x*1000000)/1000000;

/**
 * V4 multi-asset shared-cash weekly PAPER simulation.
 * No same-week signal entry. Signals use only already-completed weeks,
 * enter the next calendar week's OPEN, and cannot trade on a missing bar.
 * OHLC approximation: gaps at the OPEN processed before new entries,
 * intraperiod stops afterwards; at most four concurrent EUR positions.
 */
export function backtestWeinsteinPortfolio(instruments,benchmarkDaily,{
 asOf=new Date().toISOString().slice(0,10),initialCash=500,holdWeeks=12,
 fee=0.5,slippageFraction=0.001,maxPositions=4,
 riskFraction=0.01,maxAllocationFraction=0.25
}={}){
 if(!Array.isArray(instruments)||instruments.length>150||
  !Number.isFinite(initialCash)||initialCash<=0||![4,8,12,26].includes(holdWeeks)||
  !Number.isInteger(maxPositions)||maxPositions<1||maxPositions>10||
  ![fee,slippageFraction,riskFraction,maxAllocationFraction].every(Number.isFinite)||
  fee<0||slippageFraction<0||slippageFraction>.02||
  riskFraction<=0||riskFraction>.05||maxAllocationFraction<=0||maxAllocationFraction>1)
  throw Error('Invalid portfolio backtest parameters');
 const cutoff=mondayAt(asOf);
 // Avoid survivorship bias claims: this universe is CURRENT constituents only.
 const assets=[],symbols=new Set(),skipped=[];
 for(const asset of instruments){
  if(typeof asset.symbol!=='string'||symbols.has(asset.symbol))throw Error('Duplicate or invalid ticker');
  symbols.add(asset.symbol);
  if(asset.currency!=='EUR'){skipped.push({symbol:asset.symbol,reason:'EUR_ONLY'});continue}
  if(!Array.isArray(asset.daily)||asset.daily.length<40){skipped.push({symbol:asset.symbol,reason:'NO_HISTORY'});continue}
  const weeks=aggregateWeeks(asset.daily).filter(w=>w.week<cutoff&&w.lastDay<=asOf);
  const map=new Map(weeks.map(w=>[w.week,w]));
  const history=analyzeHistoricalPhases(asset.daily,benchmarkDaily,{asOf});
  const signals=new Map();
  for(const t of history.transitions.filter(t=>t.to==='PHASE2'&&t.confirmedBreakout)){
   const enter=mondayAfter(t.week);
   const signalIdx=weeks.findIndex(w=>w.week===t.week);
   if(signalIdx<7)continue;
   const next=map.get(enter);
   if(!next){skipped.push({symbol:asset.symbol,week:t.week,reason:'NO_NEXT_WEEK'});continue}
   const stop=Math.min(...weeks.slice(signalIdx-7,signalIdx+1).map(w=>w.low));
   const target=history.weeks.find(w=>w.week===t.week);
   // Historical phase scoring uses no forward data; sorting is deterministic.
   signals.set(enter,{symbol:asset.symbol,signalWeek:t.week,entryWeek:enter,stop,
    strength:target?.relativeStrength26Pct??0,volumeRatio:target?.volumeRatio??0});
  }
  assets.push({symbol:asset.symbol,weeks,map,signals});
 }
 const calendar=[...new Set(assets.flatMap(a=>a.weeks.map(w=>w.week)))].sort();
 const positions=new Map(),trades=[],equityCurve=[],orders=[];
 let cash=initialCash,peak=initialCash,maxDrawdownPct=0;
 for(const week of calendar){
  // Sell existing positions with opening gaps first. This releases cash
  // before purchases at the same opening timestamp.
  for(const [symbol,p] of [...positions]){
   const bar=p.asset.map.get(week);
   if(!bar){skipped.push({symbol,week,reason:'MISSING_HELD_BAR'});continue}
   const fill=bar.open<=p.stop?bar.open*(1-slippageFraction):null;
   if(fill!==null){
    const proceeds=p.qty*fill-fee;
    cash+=proceeds;
    const pnl=proceeds-p.cost;
    trades.push({symbol,signalWeek:p.signalWeek,entryWeek:p.entryWeek,exitWeek:week,
     entryPrice:p.entryPrice,exitPrice:fill,stop:p.stop,quantity:p.qty,pnl,
     exitReason:'OPEN_GAP',holdingWeeks:p.held+1});
    orders.push({symbol,week,side:'SELL',reason:'OPEN_GAP'});
    positions.delete(symbol);
   }
  }
  // All orders are sorted on information known at the prior week close.
  const candidates=assets.flatMap(a=>{
   const signal=a.signals.get(week);
   return signal?[{...signal,asset:a}]:[];
  }).sort((a,b)=>b.strength-a.strength||b.volumeRatio-a.volumeRatio||a.symbol.localeCompare(b.symbol));
  for(const candidate of candidates){
   if(positions.has(candidate.symbol)){skipped.push({symbol:candidate.symbol,week,reason:'ALREADY_HOLDING'});continue}
   if(positions.size>=maxPositions){skipped.push({symbol:candidate.symbol,week,reason:'MAX_POSITIONS'});continue}
   const bar=candidate.asset.map.get(week);
   if(!bar){skipped.push({symbol:candidate.symbol,week,reason:'MISSING_ENTRY_BAR'});continue}
   const entry=bar.open*(1+slippageFraction);
   const allocation=sizePaperPosition({cash,entry,stop:candidate.stop,riskFraction,maxAllocationFraction,fee});
   if(!allocation.eligible){
    skipped.push({symbol:candidate.symbol,week,reason:allocation.reason});continue;
   }
   const cost=allocation.quantity*entry+fee;
   cash-=cost;
   positions.set(candidate.symbol,{...candidate,qty:allocation.quantity,cost,
    entryPrice:entry,held:0});
   orders.push({symbol:candidate.symbol,week,side:'BUY',reason:'PHASE2_CONFIRMED_PRIOR_WEEK'});
  }
  // Evaluate intraperiod lows and the predefined holding horizon after
  // entries. A gap can breach the stop even on the entry week.
  for(const [symbol,p] of [...positions]){
   const bar=p.asset.map.get(week);
   if(!bar)continue;
   p.held++;
   const stop=simulateLongStop({stop:p.stop,open:bar.open,low:bar.low,high:bar.high});
   if(stop.reason==='INVALID_CANDLE')throw Error('Invalid portfolio OHLCV');
   const expired=p.held>=holdWeeks;
   if(!stop.triggered&&!expired)continue;
   const reason=stop.triggered?stop.reason:'MAX_HOLD';
   const fill=(stop.triggered?stop.fill:bar.close)*(1-slippageFraction);
   const proceeds=p.qty*fill-fee;
   cash+=proceeds;
   trades.push({symbol,signalWeek:p.signalWeek,entryWeek:p.entryWeek,exitWeek:week,
    entryPrice:p.entryPrice,exitPrice:fill,stop:p.stop,quantity:p.qty,
    pnl:proceeds-p.cost,exitReason:reason,holdingWeeks:p.held});
   orders.push({symbol,week,side:'SELL',reason});
   positions.delete(symbol);
  }
  const unrealized=[...positions.values()].reduce((sum,p)=>{
   const bar=p.asset.map.get(week);
   if(!bar)return sum+p.qty*p.entryPrice;
   return sum+p.qty*bar.close;
  },0);
  const equity=round(cash+unrealized);
  peak=Math.max(peak,equity);
  maxDrawdownPct=Math.max(maxDrawdownPct,peak>0?(1-equity/peak)*100:0);
  equityCurve.push({week,cash:round(cash),equity,openPositions:positions.size});
  if(cash<-0.00001||positions.size>maxPositions)throw Error('Portfolio invariant violated');
 }
 const finalEquity=equityCurve.at(-1)?.equity??initialCash;
 const closedPnl=trades.reduce((sum,t)=>sum+t.pnl,0);
 return {mode:'PAPER_PORTFOLIO_BACKTEST',initialCash,finalCash:round(cash),
  finalEquity,returnPct:(finalEquity/initialCash-1)*100,
  maxDrawdownPct,tradeCount:trades.length,
  winRatePct:trades.length?trades.filter(t=>t.pnl>0).length/trades.length*100:null,
  holdWeeks,maxPositions,fee,slippageFraction,
  positionsOpen:[...positions.keys()],closedPnl:round(closedPnl),
  trades,orders,skipped,equityCurve,
  symbolsAnalyzed:assets.length,
  assumptions:[
   'Signals confirmed at past weekly closes; entry at next week opening only.',
   'Shared 500 EUR notional cash, EUR instruments only, maximum 4 concurrent positions.',
   'Exits use weekly OHLC (gap at open, weekly low stop); same-week ordering is approximate.',
   'Current watchlist survivorship bias. Yahoo historical splits/dividends not independently verified.',
   'Illustrative fictitious portfolio, no taxes, no borrowing, no orders and no proof of profitability.'
  ]};
}
