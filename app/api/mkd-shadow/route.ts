import {pool} from '../../../lib/db';
import {fetchMkdLegacy,compareCandleSeries} from '../../../src/mkd-legacy-adapter.mjs';
export const dynamic='force-dynamic';
/** Read-only parity diagnostic. Does not change the scanner's source or write data. */
export async function GET(request:Request){
 if(process.env.MKD_SHADOW_ENABLED!=='true')
  return Response.json({error:'MKD shadow comparison disabled'},{status:404});
 try{
  const url=new URL(request.url);
  const symbol=url.searchParams.get('symbol')??'AC.PA';
  const start=url.searchParams.get('start')??'2021-11-12';
  const end=url.searchParams.get('end')??new Date().toISOString().slice(0,10);
  if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||
     !/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
   return Response.json({error:'Invalid symbol/date'}, {status:400});
  const instrument=(await pool.query('SELECT id,currency FROM instruments WHERE symbol=$1',[symbol])).rows[0];
  if(!instrument)return Response.json({error:'Unknown local instrument'},{status:404});
  const local=(await pool.query(`SELECT day::text AS day,open::float8 AS open,high::float8 AS high,
    low::float8 AS low,close::float8 AS close,volume::int AS volume
    FROM candles WHERE instrument_id=$1 AND day BETWEEN $2 AND $3 ORDER BY day`,
    [instrument.id,start,end])).rows;
  const mkd=await fetchMkdLegacy(symbol,{start,end});
  if(mkd.currency!==instrument.currency)
   return Response.json({error:'Currency mismatch',symbol},{status:409});
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
