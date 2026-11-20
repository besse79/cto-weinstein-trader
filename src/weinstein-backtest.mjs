import {aggregateWeeks} from './weinstein.mjs';
import {analyzeHistoricalPhases} from './weinstein-history.mjs';
import {sizePaperPosition,simulateLongStop} from './paper-risk.mjs';

const finite=x=>Number.isFinite(x);
const percent=(next,base)=>base>0?(next/base-1)*100:null;

/**
 * V4 single-symbol paper backtest. Past completed-week breakout is observed on
 * its closing day; entry is NOT permitted until the following week's OPEN.
 *
 * This prototype is not a multi-asset portfolio, a dividend-adjusted result,
 * or an executable trading signal. It only tests outcomes of observed
 * Weinstein breakouts with a 500 EUR hypothetical cash ledger.
 */
export function backtestWeinstein(daily,benchmarkDaily,{
 asOf=new Date().toISOString().slice(0,10),initialCash=500,
 holdWeeks=12,fee=0.5,slippageFraction=0.001,
 riskFraction=.01,maxAllocationFraction=.25
}={}){
 if(!finite(initialCash)||initialCash<=0||!Number.isInteger(holdWeeks)||
    ![4,8,12,26].includes(holdWeeks)||!finite(fee)||fee<0||
    !finite(slippageFraction)||slippageFraction<0||slippageFraction>.02)
  throw new Error('Invalid backtest parameters');
 const history=analyzeHistoricalPhases(daily,benchmarkDaily,{asOf});
 const scanWeeks=aggregateWeeks(daily);
 const t=new Date(asOf+'T12:00:00Z');
 if(!finite(+t))throw new Error('Invalid asOf');
 t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+6)%7);
 const cutoff=t.toISOString().slice(0,10);
 const completed=scanWeeks.filter(w=>w.week<cutoff&&w.lastDay<=asOf);
 const byWeek=new Map(completed.map((w,i)=>[w.week,i]));
 const events=history.transitions.filter(t=>t.to==='PHASE2'&&t.confirmedBreakout)
  .sort((a,b)=>a.week.localeCompare(b.week));
 let cash=initialCash,lastExitIndex=-1;
 const trades=[],skipped=[],equityCurve=[{week:null,equity:initialCash}];
 for(const signal of events){
  const i=byWeek.get(signal.week);
  if(i===undefined||i<8){skipped.push({week:signal.week,reason:'NO_HISTORY'});continue}
  const entryIndex=i+1;
  if(entryIndex>=completed.length){skipped.push({week:signal.week,reason:'NO_NEXT_WEEK'});continue}
  if(entryIndex<=lastExitIndex){skipped.push({week:signal.week,reason:'ALREADY_HOLDING'});continue}
  const entryWeek=completed[entryIndex];
  const entryPrice=entryWeek.open*(1+slippageFraction);
  // Stop determined using ONLY weeks completed before this signal, with
  // no reference to the coming entry week.
  const stop=Math.min(...completed.slice(i-7,i+1).map(w=>w.low));
  const allocation=sizePaperPosition({cash,entry:entryPrice,stop,fee,
   riskFraction,maxAllocationFraction});
  if(!allocation.eligible){
   skipped.push({week:signal.week,reason:allocation.reason});continue
  }
  const qty=allocation.quantity;
  const cost=qty*entryPrice+fee;
  cash-=cost;
  let exitIndex=null,exitReason='MAX_HOLD',exitPrice=null;
  for(let j=entryIndex;j<Math.min(completed.length,entryIndex+holdWeeks);j++){
   const w=completed[j];
   const stopCheck=simulateLongStop({stop,open:w.open,high:w.high,low:w.low});
   if(stopCheck.reason==='INVALID_CANDLE')
    throw new Error('Invalid OHLCV in backtest');
   if(stopCheck.triggered){
    exitIndex=j;exitReason=stopCheck.reason;
    exitPrice=stopCheck.fill*(1-slippageFraction);break;
   }
   if(j===entryIndex+holdWeeks-1){
    exitIndex=j;exitPrice=w.close*(1-slippageFraction);
   }
  }
  if(exitIndex===null){
   // No completed exit horizon: do not count a future return or fabricate P&L.
   cash+=cost;
   skipped.push({week:signal.week,reason:'HORIZON_NOT_COMPLETE'});
   continue;
  }
  const proceeds=qty*exitPrice-fee;
  const pnl=proceeds-cost;
  cash+=proceeds;
  lastExitIndex=exitIndex;
  const exitWeek=completed[exitIndex];
  trades.push({signalWeek:signal.week,entryWeek:entryWeek.week,
   exitWeek:exitWeek.week,entryPrice,stop,exitPrice,quantity:qty,
   entryCost:cost,exitProceeds:proceeds,pnl,returnPct:percent(proceeds,cost),
   exitReason,holdingWeeks:exitIndex-entryIndex+1});
  equityCurve.push({week:exitWeek.week,equity:cash});
 }
 const wins=trades.filter(t=>t.pnl>0);
 let high=initialCash,maxDrawdownPct=0;
 for(const point of equityCurve){
  high=Math.max(high,point.equity);
  maxDrawdownPct=Math.max(maxDrawdownPct,high>0?(1-point.equity/high)*100:0);
 }
 return {
  mode:'PAPER_BACKTEST',initialCash,endCash:cash,
  returnPct:percent(cash,initialCash),tradeCount:trades.length,
  winRatePct:trades.length?wins.length/trades.length*100:null,
  maxDrawdownPct,holdWeeks,fee,slippageFraction,
  trades,skipped,equityCurve,
  confirmedSignals:events.length,
  disclaimers:[
   'Historical estimates only; trades enter at the NEXT completed week open, never at the signal close.',
   'Single-stock sequential capital ledger; NOT a combined 24-stock portfolio simulation.',
   'Current watchlist has survivorship bias; dividend and split adjustments are unverified.',
   'Fills and gaps approximate weekly OHLC only, not executable intraday fills or commissions.',
   'All positions and cash are fictional. No real orders.'
  ]
 };
}
