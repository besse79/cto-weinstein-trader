/** Deterministic, paper-only risk and sizing calculations. No broker integration. */
const finitePositive=(x)=>Number.isFinite(x)&&x>0;
export function sizePaperPosition({cash,entry,stop,riskFraction=0.01,maxAllocationFraction=0.25,fee=0}){
 if(![cash,entry,stop,riskFraction,maxAllocationFraction,fee].every(Number.isFinite))
  return {eligible:false,reason:'NON_FINITE_INPUT'};
 if(!finitePositive(cash)||!finitePositive(entry)||!finitePositive(stop)||stop>=entry)
  return {eligible:false,reason:'INVALID_PRICE_OR_STOP'};
 if(riskFraction<=0||riskFraction>0.05||maxAllocationFraction<=0||maxAllocationFraction>1||fee<0)
  return {eligible:false,reason:'INVALID_RISK_LIMIT'};
 const perShareRisk=entry-stop;
 const riskBudget=cash*riskFraction;
 const byRisk=Math.floor(Math.max(0,riskBudget-2*fee)/perShareRisk);
 const byAllocation=Math.floor((cash*maxAllocationFraction-fee)/entry);
 const byCash=Math.floor((cash-fee)/entry);
 const quantity=Math.max(0,Math.min(byRisk,byAllocation,byCash));
 if(quantity<1)return {eligible:false,reason:'INSUFFICIENT_CAPITAL_OR_RISK',riskBudget};
 return {eligible:true,quantity,notional:quantity*entry,initialStop:stop,
  maxPlannedLoss:quantity*perShareRisk+2*fee,riskBudget,
  cashRemaining:cash-quantity*entry-fee};
}
/** Stops are simulated on completed daily OHLC candles; adverse opening gaps fill at open. */
export function simulateLongStop({stop,open,low,high}){
 if(![stop,open,low,high].every(finitePositive)||low>high||open<low||open>high)
  return {triggered:false,reason:'INVALID_CANDLE'};
 if(open<=stop)return {triggered:true,fill:open,reason:'OPEN_GAP'};
 if(low<=stop)return {triggered:true,fill:stop,reason:'STOP_TOUCHED'};
 return {triggered:false,reason:'NOT_TOUCHED'};
}
