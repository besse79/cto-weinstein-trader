/** Source policy for Weinstein'S. No implicit legacy or historical switch. */
export const SOURCE_LOCAL='LOCAL';
export const SOURCE_MKD='MKD';
export const LEGACY_PROVENANCE='MKD_LEGACY_NON_PIT';
export function resolveMarketDataSource({requested='LOCAL',gate,allowMkd=false,backtest=false}={}){
 if(requested===SOURCE_LOCAL)return {source:SOURCE_LOCAL,enabled:true};
 if(requested!==SOURCE_MKD)throw Error('Unknown market data source');
 if(backtest)throw Error('MKD legacy is not point-in-time verified; backtest prohibited');
 if(!allowMkd)throw Error('MKD switch disabled by default');
 if(!gate||gate.gatePassed!==true||gate.source!==LEGACY_PROVENANCE||
    gate.backtestEligible!==false||gate.totals?.failures!==0||
    gate.totals?.ohlcvOnly!==0||gate.totals?.uncovered!==0||
    gate.portfolio?.paperParity?.exact!==true)
  throw Error('MKD switch blocked: incomplete or invalid acceptance gate');
 // An external acceptance report is never authorization to trade or alter the DB.
 return {source:SOURCE_MKD,enabled:true,readOnly:true,backtestEligible:false};
}
