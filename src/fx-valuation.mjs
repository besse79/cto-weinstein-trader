/**
 * Pure V4.2-A currency calculations, never an order or ledger.
 * EUR/USD quoted as USD per one EUR; no historical FX is inferred.
 */
const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const money=x=>Math.round((x+Number.EPSILON)*100)/100;
function fxRate(rate){
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0)
  throw new Error('A verified positive EUR/USD rate is mandatory');
 return rate;
}
export function convertUsdToEur(amountUsd,eurUsdRate){
 if(!valid(amountUsd))throw new Error('Invalid USD amount');
 return amountUsd/fxRate(eurUsdRate);
}
export function convertEurToUsd(amountEur,eurUsdRate){
 if(!valid(amountEur))throw new Error('Invalid EUR amount');
 return amountEur*fxRate(eurUsdRate);
}
/** Display-only, with the exact currency conversion used for the risk ceiling. */
export function previewUsdPaperSize({
 equityEur,cashEur,entryUsd,stopUsd,eurUsdRate,
 buyFeeEur=0.50,sellFeeEur=0.50,
 maxRiskFraction=0.01,maxAllocationFraction=0.25
}){
 const n={equityEur,cashEur,entryUsd,stopUsd,buyFeeEur,sellFeeEur,
          maxRiskFraction,maxAllocationFraction};
 if(Object.values(n).some(x=>!valid(x))||
   equityEur<=0||cashEur<=0||entryUsd<=0||stopUsd<=0||
   stopUsd>=entryUsd||maxRiskFraction<=0||maxRiskFraction>0.05||
   maxAllocationFraction<=0||maxAllocationFraction>1)
   throw new Error('Invalid PAPER USD pricing, stops, cash or risk limits');
 const rate=fxRate(eurUsdRate);
 const entryEur=entryUsd/rate;
 const stopEur=stopUsd/rate;
 const perShareRiskEur=(entryUsd-stopUsd)/rate;
 const riskBudgetEur=equityEur*maxRiskFraction;
 const maxNotionalEur=equityEur*maxAllocationFraction;
 const byRisk=Math.floor(Math.max(0,riskBudgetEur-buyFeeEur-sellFeeEur)/perShareRiskEur);
 const byAllocation=Math.floor((maxNotionalEur-buyFeeEur)/entryEur);
 const byCash=Math.floor((cashEur-buyFeeEur)/entryEur);
 const quantity=Math.max(0,Math.min(byRisk,byAllocation,byCash));
 const maxPlannedLossEur=quantity*perShareRiskEur+buyFeeEur+sellFeeEur;
 return {
  mode:'PAPER_RESEARCH_ONLY',currency:'USD',accountCurrency:'EUR',
  rateEurUsd:rate,entryUsd,stopUsd,entryEur:money(entryEur),
  stopEur:money(stopEur),riskBudgetEur:money(riskBudgetEur),
  quantity,notionalEur:money(quantity*entryEur),
  maxPlannedLossEur:money(maxPlannedLossEur),
  sufficientForOneShare:quantity>=1,
  executable:false, // V4.2-B ledger and FX transaction controls do not exist.
  reason:quantity>=1?'V4_2_B_LEDGER_NOT_APPROVED':'INSUFFICIENT_CAPITAL_OR_RISK'
 };
}
export function valueUsdPaperPosition({qty,priceUsd,rateEurUsd}){
 if(!Number.isSafeInteger(qty)||qty<0||!valid(priceUsd))throw new Error('Invalid hypothetical USD position');
 return {currency:'USD',marketValueUsd:money(qty*priceUsd),
  marketValueEur:money(convertUsdToEur(qty*priceUsd,rateEurUsd)),
  executable:false};
}
