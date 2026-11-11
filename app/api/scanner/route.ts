import {NextRequest} from 'next/server';
import {pool} from '../../../lib/db';
import {scanWeinstein} from '../../../src/weinstein.mjs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 try{
  const now=new Date();const asOf=now.toISOString().slice(0,10);
  const bench=(await pool.query("SELECT c.day::text as day,c.open::float8 as open,c.high::float8 as high,c.low::float8 as low,c.close::float8 as close,c.volume::int as volume FROM candles c JOIN instruments i ON c.instrument_id=i.id WHERE i.symbol='SPY' AND c.day<=CURRENT_DATE ORDER BY c.day")).rows;
  const symbols=(await pool.query("SELECT id,symbol,name,currency FROM instruments WHERE symbol<>'SPY' ORDER BY symbol")).rows;
  const results=[];
  for(const i of symbols){
   const data=(await pool.query("SELECT day::text as day,open::float8 as open,high::float8 as high,low::float8 as low,close::float8 as close,volume::int as volume FROM candles WHERE instrument_id=$1 AND day<=CURRENT_DATE ORDER BY day",[i.id])).rows;
   const scan=scanWeinstein(data,{asOf,benchmarkDaily:bench});
   const last=data.at(-1);
   const lag=last?Math.max(0,(now.getTime()-Date.parse(last.day+'T12:00:00Z'))/86400000):Infinity;
   const stale=lag>10;
   results.push({id:i.id,symbol:i.symbol,name:i.name,currency:i.currency,
    last:last?{day:last.day,close:last.close}:null,
    ...scan,eligible:scan.eligible&&!stale,signal:!last?'NO_DATA':stale?'STALE_DATA':scan.signal});
  }
  return Response.json({asOf,benchmark:'SPY',results,note:'Signals use completed ISO weeks and SPY relative strength. No automatic paper orders.'});
 }catch(e){return Response.json({error:'Scanner unavailable',detail:String(e)},{status:503})}
}
