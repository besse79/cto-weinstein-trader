/**
 * Deterministic daily-bar paper stop simulation. These are NOT broker fills.
 * An existing stop is evaluated before the day's high can raise it.
 * Stops raised during a bar become effective only on the next bar.
 */
const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function evaluatePaperBar({
  entry, initialStop, currentStop, peakPrice,
  bar, slippageFraction = 0.001, trailFraction = 0.08,
  estimatedRoundTripCostsPerShare = 0
}) {
  if (![entry, initialStop, currentStop, peakPrice].every(finitePositive) ||
      initialStop >= entry || currentStop < initialStop ||
      !bar || ![bar.open, bar.high, bar.low, bar.close].every(finitePositive) ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close) ||
      !Number.isFinite(slippageFraction) || slippageFraction < 0 || slippageFraction >= 1 ||
      !Number.isFinite(trailFraction) || trailFraction <= 0 || trailFraction >= 1 ||
      !Number.isFinite(estimatedRoundTripCostsPerShare) || estimatedRoundTripCostsPerShare < 0
  ) throw new Error('Invalid paper bar or stop');

  if (bar.open <= currentStop) {
    return {
      action: 'EXIT',
      reason: 'GAP_THROUGH_STOP',
      reference: bar.open,
      fill: bar.open * (1 - slippageFraction),
      stopBeforeBar: currentStop
    };
  }
  if (bar.low <= currentStop) {
    return {
      action: 'EXIT',
      reason: 'STOP_TOUCHED',
      reference: currentStop,
      fill: currentStop * (1 - slippageFraction),
      stopBeforeBar: currentStop
    };
  }
  const maxPrice = Math.max(peakPrice, bar.high);
  const riskR = (maxPrice-entry)/(entry-initialStop);
  let proposed = currentStop;
  let mode = 'INITIAL';
  if (riskR >= 1.5) {
    proposed = Math.max(proposed, entry + estimatedRoundTripCostsPerShare);
    mode = 'BREAK_EVEN';
  }
  if (riskR >= 2) {
    proposed = Math.max(proposed, maxPrice*(1-trailFraction));
    mode = 'TRAILING';
  }
  // A new stop above the closing price is not activated on this bar:
  // its intraday trigger order is unknowable from a daily candle.
  const nextStop = proposed < bar.close ? proposed : currentStop;
  return {action:'HOLD',stopBeforeBar:currentStop,nextStop,
    peakPrice:maxPrice,mode,riskR};
}
