import {pool} from '../../../lib/db';
import {fetchMkdLegacy,compareCandleSeries} from '../../../src/mkd-legacy-adapter.mjs';
import {scanWeinstein} from '../../../src/weinstein.mjs';
import {explainSetup} from '../../../src/weinstein-explain.mjs';
import {assessWatch} from '../../../src/weinstein-watch.mjs';
export const dynamic='force-dynamic';
/** Read-only parity diagnostic. Does not change the scanner's source or write data. */
export async function GET(request:Request){
 if(process.env.MKD_SHADOW_ENABLED!=='true')
  return Response.json({error:'MKD shadow comparison disabled'},{status:404});
 try{
  const url=new URL(request.url);
  const symbol=url.searchParams.get('symbol')??'AC.PA';
  const analysis=url.searchParams.get('analysis')==='true';
  const start=url.searchParams.get('start')??'2021-11-12';
  const end=url.searchParams.get('end')??new Date().toISOString().slice(0,10);
  if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||
     !/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
   return Response.json({error:'Invalid symbol/date'}, {status:400});
  const instrument=(await pool.query('SELECT id,currency FROM instruments WHERE symbol=$1',[symbol])).rows[0];
  if(analysis&&symbol!=='SAMPO.HE')return Response.json({error:'Analysis only enabled for SAMPO.HE'},{status:400});
  if(analysis&&(!instrument||instrument.currency!=='EUR'))return Response.json({error:'EUR instrument required'},{status:409});
  if(!instrument)return Response.json({error:'Unknown local instrument'},{status:404});
  const local=(await pool.query(`SELECT day::text AS day,open::float8 AS open,high::float8 AS high,
    low::float8 AS low,close::float8 AS close,volume::int AS volume
    FROM candles WHERE instrument_id=$1 AND day BETWEEN $2 AND $3 ORDER BY day`,
    [instrument.id,start,end])).rows;
  const mkd=await fetchMkdLegacy(symbol,{start,end});
  if(mkd.currency!==instrument.currency)
   return Response.json({error:'Currency mismatch',symbol},{status:409});
  if(analysis){
   const benchmark=await fetchMkdLegacy('EXSA.DE',{start,end});
   const asOf=new Date().toISOString().slice(0,10);
   if(mkd.items.length<200||benchmark.items.length<200||benchmark.currency!=='EUR')
    return Response.json({error:'Insufficient history or benchmark'},{status:409});
   const raw=scanWeinstein(mkd.items,{asOf,benchmarkDaily:benchmark.items});
   const explained=explainSetup({...raw,lastClose:raw.lastCompletedClose});
   const last=mkd.items.at(-1);
   const benchLast=benchmark.items.at(-1);
   const lag=(day:string)=>(Date.parse(asOf+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'))/86400000;
   const status=lag(last.day)>10?'STALE_DATA':lag(benchLast.day)>10?'STALE_BENCHMARK':null;
   const watch=status?null:assessWatch(mkd.items,raw,{asOf});
   return Response.json({symbol,currency:'EUR',source:'MKD_LEGACY_NON_PIT',mode:'READ_ONLY_SHADOW',
    bars:mkd.items.length,asOf,lastDay:last.day,benchmark:'EXSA.DE',benchmarkLastDay:benchLast.day,
    signal:status??explained.signal,stage:status?'DATA_UNAVAILABLE':explained.stage,
    setupScore:status?0:explained.setupScore,watchStatus:watch?.watchStatus??null,
    watchScore:watch?.watchScore??null,technicalEligible:!status&&!!explained.eligible,
    paperEligible:false,executionAuthorized:false,backtestEligible:false},
    {headers:{'Cache-Control':'no-store'}});
  }
  const comparison=compareCandleSeries(local,mkd.items);
  return Response.json({symbol,start,end,source:'MKD_LEGACY_NON_PIT',
    backtestEligible:false,comparison:{
     localBars:comparison.localBars,mkdBars:comparison.mkdBars,exact:comparison.exact,
     missingInLocalCount:comparison.missingInLocal.length,
     missingInMkdCount:comparison.missingInMkd.length,
     differentCount:comparison.different.length,
     missingInLocalSample:comparison.missingInLocal.slice(0,20),
     missingInMkdSample:comparison.missingInMkd.slice(0,20),
     differentSample:comparison.different.slice(0,20)
    }},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:'MKD shadow comparison unavailable',detail:String(e)},{status:503})}
}
