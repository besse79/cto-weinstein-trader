/**
 * Read-only MarketDataHub legacy adapter.
 * Explicitly NON-PIT: never use these candles in historical as-of backtests.
 * Does not write to either database. Disabled unless explicitly configured.
 */
const symbolPattern=/^[A-Z0-9.\-]{1,24}$/;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
function configuredBase(){
 const raw=process.env.MKD_BASE_URL;
 if(!raw)throw Error('MKD_BASE_URL is not configured');
 const u=new URL(raw);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)
  throw Error('Invalid MKD_BASE_URL');
 return u.toString().replace(/\/$/,'');
}
async function getJson(path,fetchImpl){
 const response=await fetchImpl(configuredBase()+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok)throw Error('MKD HTTP '+response.status+' for '+path.split('?')[0]);
 return response.json();
}
export function normalizeLegacyBars(payload,currency){
 if(payload?.backtest_eligible!==false||payload?.point_in_time_verified!==false||!Array.isArray(payload.items))
  throw Error('MKD legacy provenance contract violation');
 let previous='';
 return payload.items.map(b=>{
  const day=b.date;
  const row={day,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)};
  if(!datePattern.test(day)||day<=previous||b.currency!==currency||b.provider!=='yahoo'||
     b.quality_status!=='legacy_unverified'||!Object.values(row).slice(1,5).every(v=>Number.isFinite(v)&&v>0)||
     !Number.isSafeInteger(row.volume)||row.volume<0||
     row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close))
   throw Error('Invalid MKD OHLCV, provenance, currency or date ordering');
  previous=day;
  return row;
 });
}
export async function fetchMkdLegacy(symbol,{start='2021-01-01',end=new Date().toISOString().slice(0,10),fetchImpl=fetch}={}){
 if(!symbolPattern.test(symbol)||!datePattern.test(start)||!datePattern.test(end)||start>end)
  throw Error('Invalid symbol or date range');
 const info=await getJson('/v1/legacy/resolve?symbol='+encodeURIComponent(symbol),fetchImpl);
 if(info.symbol!==symbol||!info.instrument_id||!['EUR','USD'].includes(info.currency))
  throw Error('MKD symbol mapping mismatch');
 const items=[];
 // MKD caps each request at 1,000 rows. Calendar-year slices are <= 366 daily bars.
 for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){
  const from=year===Number(start.slice(0,4))?start:year+'-01-01';
  const to=year===Number(end.slice(0,4))?end:year+'-12-31';
  const qs=new URLSearchParams({instrument_id:info.instrument_id,start:from,end:to,limit:'1000'});
  const page=await getJson('/v1/legacy/bars?'+qs,fetchImpl);
  items.push(...normalizeLegacyBars(page,info.currency));
 }
 for(let i=1;i<items.length;i++)if(items[i].day<=items[i-1].day)throw Error('MKD duplicate/unsorted dates');
 return {symbol,currency:info.currency,name:info.name,source:'MKD_LEGACY_NON_PIT',backtestEligible:false,items};
}
export function compareCandleSeries(local,mkd){
 const byDay=new Map(local.map(b=>[b.day,b]));
 const missingInLocal=[],missingInMkd=[],different=[];
 const mkdDays=new Set();
 for(const b of mkd){
  mkdDays.add(b.day);
  const a=byDay.get(b.day);
  if(!a){missingInLocal.push(b.day);continue}
  if(['open','high','low','close','volume'].some(k=>Number(a[k])!==Number(b[k])))
   different.push(b.day);
 }
 for(const a of local)if(!mkdDays.has(a.day))missingInMkd.push(a.day);
 return {localBars:local.length,mkdBars:mkd.length,missingInLocal,missingInMkd,different,
         exact:!missingInLocal.length&&!missingInMkd.length&&!different.length};
}
