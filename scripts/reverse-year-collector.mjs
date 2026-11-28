/** Run only inside the deployed application network, after verified backup.
 * Resumable newest-year-first Yahoo backfill. PAPER data only.
 * Uses the existing authenticated, transactional /api/market/sync endpoint.
 */
import pg from 'pg';
import {planReverseYearBackfill} from '../src/reverse-year-backfill.mjs';
if(!process.env.DATABASE_URL||!process.env.APP_TOKEN)throw Error('DATABASE_URL and APP_TOKEN required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const base=process.env.MARKET_API_BASE||'http://web:3000';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const asOf=process.env.BACKFILL_AS_OF||new Date().toISOString().slice(0,10);
const years=[2026,2025,2024,2023,2022,2021].filter(y=>y<=Number(asOf.slice(0,4)));
const limit=Number(process.env.BACKFILL_MAX_SYMBOL_YEARS||150);
if(!Number.isInteger(limit)||limit<1||limit>5000)throw Error('Invalid BACKFILL_MAX_SYMBOL_YEARS');
async function run(){
 const db=await pool.connect();
 try{
  const locked=(await db.query('SELECT pg_try_advisory_lock(147013) AS ok')).rows[0].ok;
  if(!locked)throw Error('Backfill already running');
  try{
   const rows=(await db.query(`SELECT i.symbol,COALESCE(jsonb_object_agg(
     EXTRACT(YEAR FROM c.day)::int::text,true) FILTER (WHERE c.day IS NOT NULL),'{}'::jsonb) AS present
     FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id
     GROUP BY i.id,i.symbol ORDER BY i.symbol`)).rows;
   // A year is verified only when a successful audit covers that year; mere
   // presence of a candle is insufficient. Missing years are retried.
   const audit=(await db.query(`SELECT symbol,EXTRACT(YEAR FROM first_day)::int AS yr,
     MIN(first_day)::text AS first_day,MAX(last_day)::text AS last_day
     FROM market_sync_audit WHERE provider IN ('YAHOO_UNOFFICIAL','YAHOO_MOCK')
     GROUP BY symbol,EXTRACT(YEAR FROM first_day)::int`)).rows;
   const bySymbol=new Map(rows.map(r=>[r.symbol,{symbol:r.symbol,verifiedYears:{}}]));
   for(const a of audit){
    const row=bySymbol.get(a.symbol);
    if(row&&a.first_day<=a.yr+'-02-15'&&a.last_day>=
      (a.yr===Number(asOf.slice(0,4))?asOf:a.yr+'-11-15'))
     row.verifiedYears[a.yr]=true;
   }
   const plan=planReverseYearBackfill([...bySymbol.values()],{asOf,years,batchSize:6,limit});
   let success=0,failed=0;
   for(const batch of plan.batches){
    const response=await fetch(base+'/api/market/sync',{method:'POST',
     headers:{'Content-Type':'application/json','x-app-token':process.env.APP_TOKEN},
     body:JSON.stringify({mode:'year',year:batch.year,symbols:batch.symbols,scheduled:true}),
     signal:AbortSignal.timeout(115000)});
    if(response.status===429||response.status===403||response.status===401){
     throw Error('Provider/access refusal; stopping safely: HTTP '+response.status);
    }
    const body=await response.json().catch(()=>({}));
    if(response.ok){success+=batch.symbols.length;console.log('OK',batch.year,batch.symbols.join(','));}
    else{failed+=batch.symbols.length;console.error('BLOCKED',batch.year,batch.symbols.join(','),String(body.detail||body.error).slice(0,200));}
    await pause(2500);
   }
   console.log(JSON.stringify({asOf,selected:plan.selected,remaining:plan.remaining,success,failed}));
  }finally{await db.query('SELECT pg_advisory_unlock(147013)')}
 }finally{db.release();await pool.end()}
}
await run();
