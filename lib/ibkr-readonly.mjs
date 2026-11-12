/**
 * IBKR Client Portal Gateway read-only helpers.
 * A configured gateway URL is the trusted local origin, e.g. https://host.docker.internal:5000.
 * No external host, credentials, or order endpoints are accepted.
 */
export function gatewayBase(raw) {
 if(typeof raw!=='string')return null;
 try {
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','host.docker.internal'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    !['','/','/v1/api','/v1/api/'].includes(url.pathname))return null;
  return url.origin+'/v1/api';
 } catch {return null}
}
export function parseIbkrHistory(payload,{asOf=new Date().toISOString().slice(0,10)}={}) {
 if(!payload || !Array.isArray(payload.data)||payload.data.length<1||payload.data.length>1000)
  throw new Error('Invalid IBKR history response');
 if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw new Error('Invalid date');
 const seen=new Set();
 const data=payload.data.map(x=>{
  const t=Number(x.t),open=Number(x.o),high=Number(x.h),low=Number(x.l),close=Number(x.c),volume=Number(x.v);
  if(!Number.isSafeInteger(t)||t<946684800000)throw new Error('Invalid bar timestamp');
  const day=new Date(t).toISOString().slice(0,10);
  if(day>asOf || seen.has(day) ||
   ![open,high,low,close].every(n=>Number.isFinite(n)&&n>0) ||
   high<Math.max(open,close,low)||low>Math.min(open,close) ||
   !Number.isSafeInteger(volume)||volume<0)throw new Error('Invalid or duplicate market bar');
  seen.add(day);return {day,open,high,low,close,volume};
 });
 return data.sort((a,b)=>a.day.localeCompare(b.day));
}

/**
 * Check broker-returned symbol against the user's allowlisted instrument.
 * The suffixes .PA and .DE represent local Paris/Xetra notation, not
 * an IBKR symbol. No automatic acceptance of a missing broker symbol.
 */
export function assertIbkrInstrument(payload, appSymbol) {
 if(!payload || typeof payload!=='object' || typeof payload.symbol!=='string' ||
    typeof appSymbol!=='string'|| !/^[A-Z0-9.-]{1,15}$/.test(appSymbol))
   throw new Error('Missing or invalid instrument identity');
 const expected=appSymbol.replace(/\.(PA|DE)$/,'');
 const returned=payload.symbol.trim().toUpperCase();
 if(!returned || returned!==expected) throw new Error('IBKR symbol does not match allowlisted instrument');
 if(payload.timePeriod!==undefined && typeof payload.timePeriod!=='string')
   throw new Error('Invalid market period metadata');
 return {appSymbol,brokerSymbol:returned};
}
