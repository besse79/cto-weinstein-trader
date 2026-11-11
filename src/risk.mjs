/** Local paper-trading risk calculations; never sends broker orders. */
export const POLICY = Object.freeze({
  initialCapitalEUR: 500,
  maxRiskFraction: 0.01,
  maxPositionFraction: 0.25,
  maxOpenPositions: 4,
  breakEvenTriggerR: 1.5,
  trailingTriggerR: 2
});
function validPositive(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0; }
export function sizePosition({equity, cash, entry, initialStop, openPositions = 0, allowFractional = false, estimatedFees = 0, policy = POLICY}) {
  if (![equity,cash,entry,initialStop].every(validPositive) || initialStop >= entry ||
      !Number.isInteger(openPositions) || openPositions < 0 || openPositions >= policy.maxOpenPositions ||
      !Number.isFinite(estimatedFees) || estimatedFees < 0) {
    return {allowed:false,reason:'INVALID_INPUT_OR_LIMIT'};
  }
  const riskPerShare = entry - initialStop;
  const remainingCash = Math.max(0,cash-estimatedFees);
  const byRisk = (equity * policy.maxRiskFraction - estimatedFees) / riskPerShare;
  const byExposure = (equity * policy.maxPositionFraction) / entry;
  const byCash = remainingCash / entry;
  let quantity = Math.max(0, Math.min(byRisk,byExposure,byCash));
  quantity = allowFractional ? Math.floor(quantity * 1000000) / 1000000 : Math.floor(quantity);
  if (!(quantity > 0)) return {allowed:false,reason:'INSUFFICIENT_CAPITAL'};
  return {
    allowed:true, quantity,
    notional:quantity*entry,
    estimatedInitialRisk:quantity*riskPerShare+estimatedFees,
    protectiveStop:initialStop
  };
}
export function updatePaperStop({entry,initialStop,currentStop,highestPrice,lastPrice,estimatedRoundTripCostsPerShare = 0,trailFraction = 0.08,policy = POLICY}) {
  if (![entry,initialStop,currentStop,highestPrice,lastPrice].every(validPositive) ||
    initialStop >= entry || currentStop < initialStop ||
    !Number.isFinite(estimatedRoundTripCostsPerShare) || estimatedRoundTripCostsPerShare < 0 ||
    !Number.isFinite(trailFraction) || trailFraction <= 0 || trailFraction >= 1) {
    throw new Error('Invalid stop inputs');
  }
  const risk = entry-initialStop;
  const peak = Math.max(highestPrice,lastPrice);
  const achievedR = (peak-entry)/risk;
  let proposed = currentStop;
  let mode = 'INITIAL';
  if (achievedR >= policy.breakEvenTriggerR) {
    proposed = Math.max(proposed,entry+estimatedRoundTripCostsPerShare);
    mode = 'BREAK_EVEN';
  }
  if (achievedR >= policy.trailingTriggerR) {
    proposed = Math.max(proposed,peak*(1-trailFraction));
    mode = 'TRAILING';
  }
  // Stops cannot be raised to or beyond the last traded price.
  const nextStop = proposed < lastPrice ? proposed : currentStop;
  return {currentStop:nextStop, mode, achievedR, stopTriggered:lastPrice<=currentStop};
}
