import {NextRequest} from 'next/server';
import {authorized} from '../../../lib/auth';
import {pool} from '../../../lib/db';
import {evaluatePaperBar} from '../../../src/paper-execution.mjs';
export const dynamic='force-dynamic';

/**
 * Process COMPLETED daily candles only. Idempotent by (instrument,day).
 * Sells are simulated in our own PostgreSQL paper ledger, never at IBKR.
 */
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 const db=await pool.connect();let begun=false;
 try{
  await db.query('BEGIN');begun=true;
  await db.query('SELECT pg_advisory_xact_lock(147001)');
  // Compatibility for databases initialized before migration 001.
  await db.query(`CREATE TABLE IF NOT EXISTS paper_stop_evaluations (
    instrument_id BIGINT NOT NULL REFERENCES instruments(id),
    day DATE NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('HOLD','EXIT')),
    simulated_price NUMERIC(18,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(instrument_id,day)
  )`);
  const stops=(await db.query('SELECT * FROM risk_stops ORDER BY instrument_id FOR UPDATE')).rows;
  const results=[];
  for(const s of stops){
   const id=Number(s.instrument_id);
   const activity=(await db.query(`SELECT side,qty::float8 as qty,created_at::text as created_at FROM orders
     WHERE instrument_id=$1 ORDER BY id`,[id])).rows;
   let held=0,lastBuyDay=null;
   for(const a of activity) {
     if(a.side==='BUY'){held+=Number(a.qty);lastBuyDay=String(a.created_at).slice(0,10)}
     else held-=Number(a.qty);
   }
   if(held<=0){results.push({instrumentId:id,status:'NO_OPEN_POSITION'});continue}
   const last=(await db.query('SELECT MAX(day)::text AS day FROM paper_stop_evaluations WHERE instrument_id=$1',[id])).rows[0]?.day;
   const candles=(await db.query(`SELECT day::text AS day,open::float8 AS open,high::float8 AS high,
       low::float8 AS low,close::float8 AS close
     FROM candles WHERE instrument_id=$1 AND day > COALESCE($2::date,'1900-01-01'::date)
       AND day > $3::date AND day < CURRENT_DATE ORDER BY day LIMIT 120`,
      [id,last,lastBuyDay])).rows;
   if(!candles.length){results.push({instrumentId:id,status:'NO_NEW_COMPLETED_BAR'});continue}
   let stop=Number(s.current_stop),peak=Number(s.peak_price);
   for(const bar of candles){
     const age=(Date.now()-Date.parse(bar.day+'T12:00:00Z'))/86400000;
     if(age>10 || age<0){
       results.push({instrumentId:id,status:'BLOCKED_STALE_DATA',day:bar.day});
       break;
     }
     const outcome=evaluatePaperBar({entry:Number(s.entry_price),initialStop:Number(s.initial_stop),
        currentStop:stop,peakPrice:peak,bar});
     const action=outcome.action;
     if(action==='EXIT'){
       const fill=Math.round(Number(outcome.fill)*1e6)/1e6;
       if(!(fill>0))throw new Error('Invalid simulated fill');
       await db.query(`INSERT INTO orders(instrument_id,side,qty,price,fee,stop,mode)
         VALUES($1,'SELL',$2,$3,0,$4,'PAPER')`,[id,held,fill,stop]);
       await db.query('DELETE FROM risk_stops WHERE instrument_id=$1',[id]);
       await db.query(`INSERT INTO paper_stop_evaluations(instrument_id,day,action,simulated_price)
         VALUES($1,$2,'EXIT',$3)`,[id,bar.day,fill]);
       results.push({instrumentId:id,status:'PAPER_EXIT',reason:outcome.reason,
         day:bar.day,qty:held,fill,reference:outcome.reference});
       break;
     }
     stop=Number(outcome.nextStop);peak=Number(outcome.peakPrice);
     await db.query(`UPDATE risk_stops SET current_stop=$1,peak_price=$2,updated_at=now()
       WHERE instrument_id=$3`,[stop,peak,id]);
     await db.query(`INSERT INTO paper_stop_evaluations(instrument_id,day,action)
       VALUES($1,$2,'HOLD')`,[id,bar.day]);
     results.push({instrumentId:id,status:'PAPER_HOLD',day:bar.day,stop,mode:outcome.mode});
   }
  }
  await db.query('COMMIT');begun=false;
  return Response.json({mode:'PAPER',realOrdersEnabled:false,results,
    execution:'DAILY_BAR_SIMULATION',slippageFraction:0.001,
    warning:'Simulated execution; missing intraday prices, market spread, exchange fees and FX.'});
 }catch(e){
  if(begun)await db.query('ROLLBACK');
  return Response.json({error:'Paper stop reconciliation failed',detail:String(e)},{status:500});
 }finally{db.release()}
}
