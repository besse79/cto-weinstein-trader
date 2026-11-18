/** Read-only audit of W NO_HISTORY symbols against MKD legacy mapping and candles.
 * Usage: node scripts/mkd-uncovered-audit.mjs /path/to/acceptance-report.json
 * No DB writes, no broker calls, no local checkout changes.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/mkd-uncovered-audit.mjs <acceptance-report.json>');
const input=JSON.parse(readFileSync(file,'utf8'));
if(input.source!=='MKD_LEGACY_NON_PIT'||!Array.isArray(input.results))
 throw Error('Unsupported acceptance report');
const symbols=input.results.filter(x=>x.kind==='NO_HISTORY').map(x=>x.symbol);
if(new Set(symbols).size!==symbols.length)throw Error('Duplicate uncovered symbols');
const base=process.env.MKD_BASE_URL??'http://127.0.0.1:8100';
const url=new URL(base);
if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='8100'||url.username||url.password)
 throw Error('Audit requires local MKD on port 8100');
const first='2021-01-01',last=new Date().toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){
 let error;
 for(let n=0;n<3;n++){
  try{
   const response=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
   if(response.status===404)return {missing:true};
   if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{permanent:response.status<500});
   return await response.json();
  }catch(e){error=e;if(e.permanent)break;if(n<2)await sleep(300*(n+1))}
 }
 throw error;
}
async function audit(symbol){
 try{
  const mapping=await get('/v1/legacy/resolve?symbol='+encodeURIComponent(symbol));
  if(mapping.missing)return {symbol,status:'MAPPING_MISSING',action:'Review Yahoo symbol and instrument identifier'};
  if(mapping.symbol!==symbol||!mapping.instrument_id||!/^[A-Z]{3}$/.test(mapping.currency??''))
   return {symbol,status:'MAPPING_INVALID',action:'Fix ambiguous or invalid mapping'};
  let count=0,earliest=null,latest=null;
  for(let y=2021;y<=Number(last.slice(0,4));y++){
   const start=y===2021?first:y+'-01-01';
   const end=y===Number(last.slice(0,4))?last:y+'-12-31';
   const qs=new URLSearchParams({instrument_id:mapping.instrument_id,start,end,limit:'1000'});
   const page=await get('/v1/legacy/bars?'+qs);
   if(page.missing||page.point_in_time_verified!==false||page.backtest_eligible!==false||!Array.isArray(page.items))
    throw Error('Legacy provenance contract violation');
   let previous='';
   for(const b of page.items){
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(b.date)||b.date<start||b.date>end||b.date<=previous||
      b.currency!==mapping.currency||b.provider!=='yahoo'||b.quality_status!=='legacy_unverified')
     throw Error('Invalid bar provenance/date/currency');
    previous=b.date;count++;
    if(!earliest||b.date<earliest)earliest=b.date;
    if(!latest||b.date>latest)latest=b.date;
   }
  }
  return {symbol,currency:mapping.currency,instrumentId:mapping.instrument_id,
   status:count?'MKD_BARS_AVAILABLE':'MKD_MAPPING_NO_BARS',bars:count,earliest,latest,
   backtestEligible:false,action:count?'Investigate W missing local history; do not backfill automatically':'Schedule source collection and quality checks'};
 }catch(e){return {symbol,status:'AUDIT_ERROR',error:String(e.message??e),action:'Investigate MKD connectivity or payload; fail closed'}}
}
const rows=new Array(symbols.length);
let cursor=0;
async function worker(){while(cursor<symbols.length){const i=cursor++;rows[i]=await audit(symbols[i])}}
await Promise.all(Array.from({length:Math.min(4,symbols.length)},()=>worker()));
const counts={};
for(const r of rows)counts[r.status]=(counts[r.status]??0)+1;
const report={generatedAt:new Date().toISOString(),input:resolve(file),source:'MKD_LEGACY_NON_PIT',
 readOnly:true,backtestEligible:false,uncoveredExpected:symbols.length,counts,rows};
const output=file.replace(/\\.json$/,'-mkd-uncovered-audit.json');
if(output===file)throw Error('Input filename must end in .json');
writeFileSync(output,JSON.stringify(report,null,2)+'\\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({report:output,total:symbols.length,counts,samples:rows.filter(r=>r.status!=='MKD_BARS_AVAILABLE').slice(0,15)},null,2));
if(counts.AUDIT_ERROR||counts.MAPPING_INVALID)process.exitCode=2;
