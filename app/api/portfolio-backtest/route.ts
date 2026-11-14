import {pool} from '../../../lib/db';
import {backtestWeinsteinPortfolio} from '../../../src/weinstein-portfolio.mjs';
export const dynamic='force-dynamic';
const SQL='SELECT day::text AS day,open::float8 AS open,high::float8 AS high,low::float8 AS low,close::float8 AS close,volume::int AS volume FROM candles WHERE instrument_id=$1 AND day<=CURRENT_DATE ORDER BY day';
export async function GET(req:Request){
 try{
  const query=new URL(req.url);
  const holdWeeks=Number(query.searchParams.get('weeks')??12);
  if(![4,8,12,26].includes(holdWeeks))
   return Response.json({error:'Invalid holding horizon'},{status:400});
  const instruments=(await pool.query('SELECT id,symbol,name,currency FROM instruments ORDER BY symbol')).rows;
  const bench=instruments.find(i=>i.symbol==='EXSA.DE'&&i.currency==='EUR');
  if(!bench)return Response.json({error:'EUR benchmark not configured'},{status:409});
  const benchmarkDaily=(await pool.query(SQL,[bench.id])).rows;
  if(benchmarkDaily.length<250)return Response.json({error:'EUR benchmark history insufficient'},{status:409});
  const now=new Date(),asOf=now.toISOString().slice(0,10);
  const lag=(day:string)=>(now.getTime()-Date.parse(day+'T12:00:00Z'))/86400000;
  if(lag(benchmarkDaily.at(-1).day)>10)
   return Response.json({error:'EUR benchmark stale'},{status:409});
  const stocks=instruments.filter(i=>i.currency==='EUR'&&i.symbol!==bench.symbol);
  if(stocks.length>150)return Response.json({error:'Portfolio universe exceeds safety limit'},{status:409});
  const assets=[];
  for(const stock of stocks){
   const daily=(await pool.query(SQL,[stock.id])).rows;
   // Do not reinterpret old stale quotes as a current trading universe.
   if(!daily.length||lag(daily.at(-1).day)>10)continue;
   assets.push({symbol:stock.symbol,currency:'EUR',daily});
  }
  const result=backtestWeinsteinPortfolio(assets,benchmarkDaily,{asOf,holdWeeks});
  return Response.json({asOf,benchmark:'EXSA.DE',instrumentsAvailable:stocks.length,
    instrumentsTested:assets.length,result,
    note:'Read-only fictional backtest: does not write or trade. Missing/stale instruments excluded.'});
 }catch(e){
  return Response.json({error:'Portfolio simulation unavailable',detail:String(e)},{status:503});
 }
}
