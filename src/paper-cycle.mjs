/**
 * Local scheduler orchestration, never submits broker orders.
 * All configured historical IBKR syncs must succeed before paper-stop processing.
 */
export async function runPaperCycle({symbols, request, onEvent = () => {}}) {
 if (!Array.isArray(symbols) || !symbols.length || symbols.some(s => !/^[A-Z0-9.\-]{1,15}$/.test(s)) ||
   new Set(symbols).size !== symbols.length) {
  throw new Error('Nonempty, unique allowlist required');
 }
 const report={synced:[],stopsProcessed:false,mode:'PAPER'};
 for(const symbol of symbols) {
  let response;
  try { response=await request('/api/ibkr/history',{symbol}); }
  catch(e) {onEvent({type:'BLOCKED',symbol,reason:'SYNC_TRANSPORT'});throw new Error('Blocked: IBKR history fetch failed for '+symbol,{cause:e})}
  if(!response || response.ok!==true || response.provider!=='IBKR' ||
       response.mode!=='READ_ONLY' || response.symbol!==symbol ||
       !Number.isInteger(response.count) || response.count<1) {
    onEvent({type:'BLOCKED',symbol,reason:'UNVERIFIED_DATA'});
    throw new Error('Blocked: IBKR history not verified for '+symbol);
  }
  report.synced.push({symbol,count:response.count,last:response.last});
  onEvent({type:'SYNCED',symbol,count:response.count});
 }
 const stops=await request('/api/stops',{});
 if(!stops || stops.mode!=='PAPER' || stops.realOrdersEnabled!==false ||
    !Array.isArray(stops.results))throw new Error('Stop processor failed closed');
 report.stopsProcessed=true;
 report.results=stops.results;
 onEvent({type:'STOPS_PROCESSED',count:stops.results.length});
 return report;
}
