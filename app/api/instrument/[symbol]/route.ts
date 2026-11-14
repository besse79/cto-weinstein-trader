import {pool} from '../../../../lib/db';
import {buildInstrumentDetail} from '../../../../src/instrument-detail.mjs';
export const dynamic='force-dynamic';

const BENCHMARK:Record<string,string>={EUR:'EXSA.DE',USD:'SPY'};
const Q='SELECT day::text AS day,open::float8 AS open,high::float8 AS high,low::float8 AS low,close::float8 AS close,volume::int AS volume FROM candles WHERE instrument_id=$1 AND day<=CURRENT_DATE ORDER BY day';
export async function GET(_request:Request,{params}:{params:Promise<{symbol:string}>}){
 try{
  const {symbol}=await params;
  if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol))
   return Response.json({error:'Invalid symbol'},{status:400});
  const instrument=(await pool.query('SELECT id,symbol,name,currency FROM instruments WHERE symbol=$1',[symbol])).rows[0];
  if(!instrument)return Response.json({error:'Instrument not in watchlist'},{status:404});
  const reference=BENCHMARK[instrument.currency];
  const benchmark=reference?(await pool.query('SELECT id FROM instruments WHERE symbol=$1',[reference])).rows[0]:null;
  const [data,benchmarkData]=await Promise.all([
   pool.query(Q,[instrument.id]),
   benchmark?pool.query(Q,[benchmark.id]):Promise.resolve({rows:[]})
  ]);
  const now=new Date(),asOf=now.toISOString().slice(0,10);
  const result=buildInstrumentDetail(data.rows,benchmarkData.rows,{asOf});
  const last=data.rows.at(-1);
  const lastReference=benchmarkData.rows.at(-1);
  const lag=(x:any)=>x?.day?(now.getTime()-Date.parse(x.day+'T12:00:00Z'))/86400000:Infinity;
  const status=!last?'NO_DATA':lag(last)>10?'STALE_DATA':!lastReference?'NO_BENCHMARK':lag(lastReference)>10?'STALE_BENCHMARK':null;
  const reasons=status?[status==='NO_DATA'?'Aucune cotation':
     status==='STALE_DATA'?'Dernier cours trop ancien':
     status==='NO_BENCHMARK'?'Indice de référence absent':'Indice de référence périmé']:result.assessment.reasons;
  return Response.json({instrument,benchmark:reference,asOf,latest:last?{day:last.day,close:last.close}:null,
   marketStatus:status??'READY',series:result.weeks,levels:result.levels,
   historical:status?null:result.historical,
   watch:status?null:result.watch,
   highlight:status?null:result.highlight,assessment:{
    ...result.assessment,signal:status??result.assessment.signal,
    eligible:!status&&result.assessment.eligible,reasons
   },metrics:result.indicators,explanation:result.explanation,
   note:'Données stockées localement; aucun appel Yahoo, aucune opération réelle.'});
 }catch(e){return Response.json({error:'Instrument detail unavailable',detail:String(e)},{status:503})}
}
