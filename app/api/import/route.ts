import {NextRequest} from 'next/server';
import {authorized} from '../../../lib/auth';
import {pool} from '../../../lib/db';
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 let b;try{b=await req.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 if(!Array.isArray(b.candles)||b.candles.length===0||b.candles.length>5000)
  return Response.json({error:'Expected candles array (1..5000)'},{status:400});
 const symbol=String(b.symbol||'');
 const db=await pool.connect();let started=false;
 try{
  await db.query('BEGIN');started=true;
  const i=(await db.query('SELECT id FROM instruments WHERE symbol=$1',[symbol])).rows[0];
  if(!i)throw new Error('Unknown symbol');
  for(const c of b.candles){
   if(typeof c.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.day)||Number.isNaN(Date.parse(c.day)))throw new Error('Invalid date');
   const vals=[c.open,c.high,c.low,c.close].map(Number),v=Number(c.volume);
   if(vals.some(x=>!Number.isFinite(x)||x<=0)||!Number.isSafeInteger(v)||v<0||
     vals[1]<Math.max(vals[0],vals[2],vals[3])||vals[2]>Math.min(vals[0],vals[3]))
    throw new Error('Invalid OHLCV');
   await db.query('INSERT INTO candles(instrument_id,day,open,high,low,close,volume) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(instrument_id,day) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume',[i.id,c.day,...vals,v]);
  }
  await db.query('COMMIT');started=false;return Response.json({ok:true,count:b.candles.length});
 }catch(e){if(started)await db.query('ROLLBACK');return Response.json({error:String(e)},{status:400})}
 finally{db.release()}
}
