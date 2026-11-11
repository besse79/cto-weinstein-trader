import {NextRequest} from 'next/server';
import {authorized} from '../../../lib/auth';
import {pool} from '../../../lib/db';
import {updatePaperStop} from '../../../src/risk.mjs';
export const dynamic='force-dynamic';
/** Update local paper stops based on available closing prices, never place broker orders. */
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 const db=await pool.connect();let begun=false;
 try{
  await db.query('BEGIN');begun=true;await db.query('SELECT pg_advisory_xact_lock(147001)');
  const stops=(await db.query('SELECT * FROM risk_stops ORDER BY instrument_id FOR UPDATE')).rows;
  const result=[];
  for(const s of stops){
   const q=(await db.query('SELECT day::text AS day,close::float8 AS close FROM candles WHERE instrument_id=$1 ORDER BY day DESC LIMIT 1',[s.instrument_id])).rows[0];
   if(!q){result.push({instrumentId:s.instrument_id,status:'BLOCKED_NO_QUOTE'});continue}
   const age=(Date.now()-Date.parse(q.day+'T12:00:00Z'))/86400000;
   if(age>10||age< -1){result.push({instrumentId:s.instrument_id,status:'BLOCKED_STALE_QUOTE'});continue}
   const previous=Number(s.current_stop),last=Number(q.close);
   if(last<=previous){result.push({instrumentId:s.instrument_id,status:'SELL_REVIEW',stop:previous,last,day:q.day});continue}
   const updated=updatePaperStop({entry:Number(s.entry_price),initialStop:Number(s.initial_stop),
     currentStop:previous,highestPrice:Math.max(Number(s.peak_price),last),lastPrice:last});
   await db.query('UPDATE risk_stops SET peak_price=$1,current_stop=$2,updated_at=now() WHERE instrument_id=$3',
     [Math.max(Number(s.peak_price),last),updated.currentStop,s.instrument_id]);
   result.push({instrumentId:s.instrument_id,status:'UPDATED',mode:updated.mode,stop:updated.currentStop,last,day:q.day});
  }
  await db.query('COMMIT');begun=false;
  return Response.json({mode:'PAPER',realOrdersEnabled:false,results:result,
    note:'Only close-based stop review. No simulated execution until intraday gap/slippage validation.'});
 }catch(e){if(begun)await db.query('ROLLBACK');return Response.json({error:String(e)},{status:500})}
 finally{db.release()}
}
