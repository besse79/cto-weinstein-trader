/**
 * W V4.2-A: read-only MKD market data adapter.
 * Strictly no DDL/DML; the operational Weinstein scanner remains on local
 * PostgreSQL until a real W<->MKD parity gate is approved.
 * MKD's absence is visible: the local fallback is NEVER called "MKD".
 */
export class MkdUnavailable extends Error {
 constructor(message){super(message);this.name='MkdUnavailable'}
}
export class MkdInvalidData extends Error {
 constructor(message){super(message);this.name='MkdInvalidData'}
}
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const CURRENCY=new Set(['EUR','USD']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const utcTime=v=>{
 const time=Date.parse(v);
 if(typeof v!=='string'||!Number.isFinite(time)||!/(Z|[+-]\d\d:\d\d)$/.test(v))
  throw new MkdInvalidData('MKD requires timezone-aware timestamps');
 return time;
};
function dateDay(x){
 if(typeof x!=='string'||!DAY.test(x)||new Date(x+'T12:00:00Z').toISOString().slice(0,10)!==x)
  throw new MkdInvalidData('Invalid ISO session date');
 return x;
}
export function checkedBaseUrl(value){
 if(typeof value!=='string'||!value.trim())throw new MkdUnavailable('MKD_URL_UNCONFIGURED');
 let u;
 try{u=new URL(value)}catch{throw new MkdInvalidData('Invalid MKD endpoint')}
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||
   !['http:','https:'].includes(u.protocol))
  throw new MkdInvalidData('MKD endpoint must be a clean HTTPS or internal HTTP origin');
 if(u.protocol==='http:'&&!['localhost','127.0.0.1','host.docker.internal','mkd','market-data-hub'].includes(u.hostname))
  throw new MkdInvalidData('External cleartext MKD endpoints forbidden');
 return u.origin;
}
function checkAsOf(asOf,now){
 const at=utcTime(asOf);
 if(at>now)throw new MkdInvalidData('Future MKD as_of not allowed');
 return at;
}
async function requestJson(base,path,params,fetchImpl){
 const u=new URL(path,checkedBaseUrl(base));for(const [key,value] of Object.entries(params))u.searchParams.set(key,String(value));
 let r;
 try{
  r=await fetchImpl(u.toString(),{cache:'no-store',headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(6000)});
 }catch(e){throw new MkdUnavailable('MKD_NETWORK_UNAVAILABLE '+String(e).slice(0,130))}
 if(r.status===404||r.status===429||r.status>=500)
  throw new MkdUnavailable('MKD_HTTP_'+r.status);
 if(!r.ok)throw new MkdInvalidData('MKD_HTTP_'+r.status);
 try{return await r.json()}catch{throw new MkdInvalidData('Invalid MKD JSON')}
}
export function validateMkdBars(document,{currency,asOf,start,end}){
 const at=utcTime(asOf);
 dateDay(start);dateDay(end);
 if(!document||!Array.isArray(document.items)||document.items.length===0||
  document.items.length>1000)throw new MkdInvalidData('MKD certified bars missing or over limit');
 const dates=new Set();
 const bars=[];
 let previousDay=null;
 for(const b of document.items){
  const day=dateDay(b.date);
  if(previousDay!==null&&day<=previousDay)
   throw new MkdInvalidData('MKD bars must be strictly chronological');
  previousDay=day;
  if(day<start||day>end||day>asOf.slice(0,10)||dates.has(day)||!CURRENCY.has(b.currency)||
     b.currency!==currency||!Number.isSafeInteger(b.volume)||b.volume<0)
   throw new MkdInvalidData('MKD bar identity, currency, or volume invalid');
  const prices=['open','high','low','close'].map(k=>Number(b[k]));
  if(['open','high','low','close'].some(k=>b[k]===null||b[k]===undefined)||
    !prices.every(x=>finite(x)&&x>0)||
    prices[1]<Math.max(prices[0],prices[2],prices[3])||
    prices[2]>Math.min(prices[0],prices[1],prices[3]))
   throw new MkdInvalidData('MKD invalid OHLC values');
  if(utcTime(b.published_at)>at||utcTime(b.first_available_at)>at)
   throw new MkdInvalidData('MKD look-ahead timestamp');
  if(typeof b.provider!=='string'||!b.provider||
     !Number.isInteger(b.revision)||b.revision<1)
   throw new MkdInvalidData('MKD bar provenance incomplete');
  dates.add(day);
  bars.push({day,open:prices[0],high:prices[1],low:prices[2],
    close:prices[3],volume:b.volume,provider:b.provider,
    revision:b.revision,publishedAt:b.published_at,firstAvailableAt:b.first_available_at});
 }
 return bars;
}
export async function fetchMkdBars({baseUrl,symbol,mic,start,end,asOf,
 fetchImpl=fetch,now=Date.now()}){
 if(!/^[A-Z0-9.^-]{1,24}$/.test(symbol)||!/^[A-Z0-9]{4}$/.test(mic))
  throw new MkdInvalidData('Invalid instrument identifier');
 const at=checkAsOf(asOf,now);
 if(dateDay(end)<dateDay(start)||end>asOf.slice(0,10))
  throw new MkdInvalidData('Invalid date range');
 const inst=await requestJson(baseUrl,'/v1/instruments',{symbol,mic,as_of:asOf},fetchImpl);
 if(inst.symbol!==symbol||inst.mic!==mic||!CURRENCY.has(inst.currency)||
   !/^[a-f0-9-]{36}$/i.test(inst.instrument_id))
  throw new MkdInvalidData('MKD instrument identity is ambiguous or inconsistent');
 const doc=await requestJson(baseUrl,'/v1/bars',{
  instrument_id:inst.instrument_id,start,end,as_of:asOf,limit:1000
 },fetchImpl);
 if(doc.instrument_id!==inst.instrument_id)
  throw new MkdInvalidData('MKD bars instrument mismatch');
 const bars=validateMkdBars(doc,{currency:inst.currency,asOf,start,end});
 return {source:'MKD',symbol,mic,name:inst.name,currency:inst.currency,
    asOf,bars,latest:bars.at(-1).day,verified:true};
}
export function validateMkdFx(record,{date,asOf}){
 const at=utcTime(asOf);
 if(!record||record.base!=='EUR'||record.quote!=='USD'||
    record.effective_date!==date||dateDay(date)>asOf.slice(0,10))
  throw new MkdInvalidData('MKD FX identity/date mismatch');
 const rate=Number(record.rate);
 if(record.rate===null||record.rate===undefined||!finite(rate)||rate<=0||
    utcTime(record.published_at)>at||utcTime(record.first_available_at)>at||
    typeof record.provider!=='string'||!record.provider||
    !Number.isInteger(record.revision)||record.revision<1)
  throw new MkdInvalidData('MKD FX rate, timestamp or provenance invalid');
 return {source:'MKD',base:'EUR',quote:'USD',date,rate,asOf,
  provider:record.provider,revision:record.revision,
  publishedAt:record.published_at,firstAvailableAt:record.first_available_at};
}
export async function fetchMkdFx({baseUrl,date,asOf,fetchImpl=fetch,now=Date.now()}){
 checkAsOf(asOf,now);dateDay(date);
 const data=await requestJson(baseUrl,'/v1/fx',{
  base:'EUR',quote:'USD',date,as_of:asOf
 },fetchImpl);
 return validateMkdFx(data,{date,asOf});
}
export async function getPreviewBars({enabled=false,localRead,...options}){
 if(typeof localRead!=='function')throw new Error('Read-only local datasource required');
 if(!enabled){
  return {...await localRead(),'source':'W_LOCAL','mkdEnabled':false,verified:false};
 }
 try{
  return {...await fetchMkdBars(options),mkdEnabled:true};
 }catch(err){
  if(!(err instanceof MkdUnavailable))throw err; // malformed: fail closed!
  const local=await localRead();
  return {...local,source:'W_LOCAL_FALLBACK',mkdEnabled:true,verified:false,
    fallbackReason:err.message};
 }
}
