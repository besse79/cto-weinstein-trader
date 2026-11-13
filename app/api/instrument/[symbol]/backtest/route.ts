import {pool} from '../../../../../lib/db';
import {backtestWeinstein} from '../../../../../src/weinstein-backtest.mjs';
export const dynamic='force-dynamic';
const B:Record<string,string>={EUR:'EXSA.DE',USD:'SPY'};
const QUERY='SELECT day::text AS day,open::float8 AS open,high::float8 AS high,low::float8 AS low,close::float8 AS close,volume::int AS volume FROM candles WHERE instrument_id=$1 AND day<=CURRENT_DATE ORDER BY day';
export async function GET(req:Request,{params}:{params:Promise<{symbol:string}>}){
 try{
  const {symbol}=await params;
  if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol))return Response.json({error:'Invalid ticker'},{status:400});
  const instrument=(await pool.query('SELECT id,symbol,name,currency FROM instruments WHERE symbol=$1',[symbol])).rows[0];
  if(!instrument)return Response.json({error:'Instrument not in watchlist'},{status:404});
  // V4 simulation uses a 500-EUR ledger. USD equities need a proper historical
  // EUR/USD FX conversion before portfolio-return calculations are meaningful.
  if(instrument.currency!=='EUR')return Response.json({
   error:'Historical EUR/USD FX is not implemented; USD portfolio backtest blocked',
   reason:'FX_HISTORY_REQUIRED'},{status:422});
  const url=new URL(req.url);
  const h=Number(url.searchParams.get('weeks')??12);
  if(![4,8,12,26].includes(h))return Response.json({error:'Invalid horizon'},{status:400});
  const benchmark=(await pool.query('SELECT id FROM instruments WHERE symbol=$1',[B[instrument.currency]])).rows[0];
  if(!benchmark)return Response.json({error:'Benchmark missing'},{status:409});
  const [candles,bench]=await Promise.all([pool.query(QUERY,[instrument.id]),pool.query(QUERY,[benchmark.id])]);
  if(!candles.rows.length||!bench.rows.length)
   return Response.json({error:'OHLCV or benchmark not imported'},{status:409});
  const now=new Date();
  const lag=(day:string)=>(now.getTime()-Date.parse(day+'T12:00:00Z'))/86400000;
  if(lag(candles.rows.at(-1).day)>10||lag(bench.rows.at(-1).day)>10)
   return Response.json({error:'OHLCV or benchmark stale'},{status:409});
  const summary=backtestWeinstein(candles.rows,bench.rows,{asOf:now.toISOString().slice(0,10)});
  // Change horizon on demand without modifying persisted paper orders.
  const result=h===summary.holdWeeks?summary:
   backtestWeinstein(candles.rows,bench.rows,{asOf:now.toISOString().slice(0,10),holdWeeks:h});
  return Response.json({instrument:{symbol:instrument.symbol,name:instrument.name,currency:instrument.currency},
   benchmark:B[instrument.currency],asOf:now.toISOString().slice(0,10),result,
   note:'PAPER-only, no writes, no Yahoo calls and no brokerage connection.'});
 }catch(e){return Response.json({error:'Backtest unavailable',detail:String(e)},{status:503})}
}
