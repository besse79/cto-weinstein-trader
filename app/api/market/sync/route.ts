import {NextRequest} from 'next/server';
import {authorized} from '../../../../lib/auth';
import {pool} from '../../../../lib/db';
import {yahooChartUrl,parseYahooChart,YAHOO_PROVIDER} from '../../../../src/yahoo-market.mjs';
export const dynamic='force-dynamic';
export const maxDuration=120;

/**
 * Authenticated synchronization for personal PAPER research, from a user's
 * explicit import or the bounded daily collection worker.
 * On ANY provider error no candle of the requested batch is written.
 * No Yahoo API key, broker account or trading endpoint.
 */
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 let body:any;
 try{body=await req.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 if(!body||typeof body!=='object'||Array.isArray(body))
  return Response.json({error:'Invalid request'},{status:400});
 // Existing clients using {all:true} retain the original core-six import.
 // Expansion is opt-in: one explicitly selected batch of up to six tickers.
 const range=body.mode==='delta'?'3mo':'5y';
 if(body.mode!==undefined&&!['delta','history'].includes(body.mode))
  return Response.json({error:'Invalid collection mode'},{status:400});
 const core=['EXSA.DE','SPY','AC.PA','LR.PA','SAF.PA','SU.PA'];
 const all=body.all===true;
 const symbols=all?core:body.symbols;
 const symbol=typeof body.symbol==='string'?body.symbol:null;
 if(!all && symbols===undefined &&
    (typeof symbol!=='string'|| !/^[A-Z0-9.^-]{1,24}$/.test(symbol)))
  return Response.json({error:'Invalid symbol'},{status:400});
 if(!all && symbols!==undefined &&
    (!Array.isArray(symbols)||symbols.length<1||symbols.length>6||
      symbols.some(s=>typeof s!=='string'|| !/^[A-Z0-9.^-]{1,24}$/.test(s))||
      new Set(symbols).size!==symbols.length))
  return Response.json({error:'Expected 1..6 distinct Yahoo ticker symbols'},{status:400});
 const db=await pool.connect();
 let locked=false,transaction=false;
 try{
  const lock=(await db.query('SELECT pg_try_advisory_lock(147005) AS acquired')).rows[0]?.acquired;
  if(!lock)return Response.json({error:'Market sync already running'},{status:409});
  locked=true;
  const selected=Array.isArray(symbols)?symbols:[symbol];
  const instruments=(await db.query(
    "SELECT id,symbol,currency FROM instruments WHERE symbol = ANY($1::text[]) ORDER BY CASE WHEN symbol IN ('EXSA.DE','SPY') THEN 0 ELSE 1 END,symbol",
    [selected])).rows;
  if(!instruments.length || instruments.length!==selected.length)
   return Response.json({error:'Unknown ticker in requested batch; no import executed'},{status:404});
  // Test override is only available inside explicitly marked GitHub CI.
  const mock=process.env.CI==='true' && process.env.YAHOO_TEST_BASE_URL;
  const testBase=mock?String(process.env.YAHOO_TEST_BASE_URL):'';
  if(mock && !/^http:\/\/(host\.docker\.internal|127\.0\.0\.1|localhost):5056$/.test(testBase))
   throw new Error('Invalid test-only provider endpoint');
  const snapshots=[];
  for(const instrument of instruments){
   const url=yahooChartUrl(instrument.symbol,mock?testBase:undefined,range);
   const response=await fetch(url,{cache:'no-store',headers:{'Accept':'application/json'},
     signal:AbortSignal.timeout(16000)});
   if(!response.ok)throw new Error('Yahoo provider unavailable (HTTP '+response.status+'); no data written');
   const json=await response.json();
   const parsed=parseYahooChart(json,{symbol:instrument.symbol,currency:instrument.currency});
   snapshots.push({id:instrument.id,...parsed});
  }
  await db.query('BEGIN');transaction=true;
  await db.query(`CREATE TABLE IF NOT EXISTS market_sync_audit(
    id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, symbol TEXT NOT NULL,
    first_day DATE NOT NULL,last_day DATE NOT NULL, candles_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  let total=0;
  for(const snap of snapshots){
   for(let offset=0;offset<snap.bars.length;offset+=200){
    const group=snap.bars.slice(offset,offset+200);
    const params:any[]=[];
    const tuples=group.map((b:any,i:number)=>{
     const n=i*7;
     params.push(snap.id,b.day,b.open,b.high,b.low,b.close,b.volume);
     return '('+Array.from({length:7},(_,j)=>'$'+(n+j+1)).join(',')+')';
    });
    await db.query(`INSERT INTO candles(instrument_id,day,open,high,low,close,volume)
      VALUES ${tuples.join(',')} ON CONFLICT(instrument_id,day) DO UPDATE SET
      open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,
      close=EXCLUDED.close,volume=EXCLUDED.volume`,params);
   }
   total+=snap.bars.length;
   await db.query('INSERT INTO market_sync_audit(provider,symbol,first_day,last_day,candles_count) VALUES($1,$2,$3,$4,$5)',
     [mock?'YAHOO_MOCK':YAHOO_PROVIDER,snap.symbol,snap.first,snap.last,snap.bars.length]);
  }
  await db.query('COMMIT');transaction=false;
  return Response.json({ok:true,provider:mock?'YAHOO_MOCK':YAHOO_PROVIDER,mode:'PAPER',
    scheduled:body.scheduled===true,window:range,total,results:snapshots.map(s=>({symbol:s.symbol,count:s.bars.length,first:s.first,last:s.last})),
    warning:'Unofficial Yahoo chart endpoint; no SLA and use is subject to Yahoo terms. No real orders.'});
 }catch(e){
  if(transaction)await db.query('ROLLBACK');
  return Response.json({error:'Yahoo market sync blocked',detail:e instanceof Error?e.message:'Unknown provider error',
    paperOnly:true},{status:502});
 }finally{
  if(locked)await db.query('SELECT pg_advisory_unlock(147005)');
  db.release();
 }
}
