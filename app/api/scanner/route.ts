import {pool} from '../../../lib/db';
import {scanWeinstein} from '../../../src/weinstein.mjs';
export const dynamic='force-dynamic';

const BENCHMARK_BY_CURRENCY:Record<string,string>={EUR:'EXSA.DE',USD:'SPY'};
const BAR_SQL="SELECT day::text AS day,open::float8 AS open,high::float8 AS high,low::float8 AS low,close::float8 AS close,volume::int AS volume FROM candles WHERE instrument_id=$1 AND day<=CURRENT_DATE ORDER BY day";

export async function GET(){
 try{
  const now=new Date(),asOf=now.toISOString().slice(0,10);
  const all=(await pool.query("SELECT id,symbol,name,currency FROM instruments ORDER BY symbol")).rows;
  const benchmarks=new Map<string,unknown[]>();
  for(const [currency,symbol] of Object.entries(BENCHMARK_BY_CURRENCY)){
   const reference=all.find(i=>i.symbol===symbol&&i.currency===currency);
   if(!reference)continue;
   benchmarks.set(currency,(await pool.query(BAR_SQL,[reference.id])).rows);
  }
  const results=[];
  for(const i of all){
   if(Object.values(BENCHMARK_BY_CURRENCY).includes(i.symbol))continue;
   const data=(await pool.query(BAR_SQL,[i.id])).rows;
   const last=data.at(-1);
   const benchmark=BENCHMARK_BY_CURRENCY[i.currency];
   const comparison=benchmarks.get(i.currency);
   const scan=scanWeinstein(data,{asOf,benchmarkDaily:comparison??[]});
   const lag=last?(now.getTime()-Date.parse(last.day+'T12:00:00Z'))/86400000:Infinity;
   const stale=lag>10;
   const benchmarkLast=comparison?.at(-1) as {day?:string}|undefined;
   const benchmarkLag=benchmarkLast?.day?(now.getTime()-Date.parse(benchmarkLast.day+'T12:00:00Z'))/86400000:Infinity;
   const noBenchmark=!comparison?.length;
   const staleBenchmark=benchmarkLag>10;
   const signal=!last?'NO_DATA':stale?'STALE_DATA':noBenchmark?'NO_BENCHMARK':staleBenchmark?'STALE_BENCHMARK':scan.signal;
   results.push({
    id:i.id,symbol:i.symbol,name:i.name,currency:i.currency,
    last:last?{day:last.day,close:last.close}:null,
    ...scan,benchmark:benchmark??null,
    eligible:scan.eligible&&!stale&&!noBenchmark&&!staleBenchmark,
    stage:stale||noBenchmark||staleBenchmark?'DATA_UNAVAILABLE':scan.stage,
    stageRank:stale||noBenchmark||staleBenchmark?99:(scan.stageRank??98),
    setupScore:stale||noBenchmark||staleBenchmark?0:(scan.setupScore??0),
    signal
   });
  }
  results.sort((a,b)=>a.stageRank-b.stageRank || b.setupScore-a.setupScore || a.symbol.localeCompare(b.symbol));
  return Response.json({asOf,benchmarkByCurrency:BENCHMARK_BY_CURRENCY,results,
   note:'Weekly Weinstein signals use completed ISO weeks and same-currency benchmarks. No broker orders.'});
 }catch(e){return Response.json({error:'Scanner unavailable',detail:String(e)},{status:503})}
}
