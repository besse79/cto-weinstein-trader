import {NextRequest} from 'next/server';
import {authorized} from '../../../../lib/auth';
import {pool} from '../../../../lib/db';
export const dynamic='force-dynamic';
/**
 * IBKR historical market data adapter. READ-ONLY at broker.
 * Uses allowlisted conids and local gateway; never hits order endpoints.
 */
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 const gateway=process.env.IBKR_GATEWAY_URL||'';
 if(!/^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(gateway))
  return Response.json({error:'Local IBKR gateway not configured'},{status:503});
 let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 const symbol=String(body.symbol||'');
 if(!/^[A-Z0-9.\-]{1,15}$/.test(symbol))return Response.json({error:'Invalid symbol'},{status:400});
 let mapping;try{mapping=JSON.parse(process.env.IBKR_CONIDS_JSON||'{}')}catch{return Response.json({error:'Invalid IBKR mapping configuration'},{status:503})}
 const conid=mapping[symbol];
 if(!Number.isSafeInteger(conid)||conid<=0)return Response.json({error:'Instrument not configured in IBKR allowlist'},{status:400});
 const instrument=await pool.query('SELECT id FROM instruments WHERE symbol=$1',[symbol]);
 if(!instrument.rows.length)return Response.json({error:'Unknown instrument'},{status:404});
 const url=new URL(gateway+'/iserver/marketdata/history');
 url.searchParams.set('conid',String(conid));url.searchParams.set('period','2y');url.searchParams.set('bar','1d');url.searchParams.set('outsideRth','false');
 try{
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return Response.json({error:'IBKR historical data request failed',status:response.status},{status:502});
  const json=await response.json();
  if(!Array.isArray(json.data)||json.data.length<1||json.data.length>1000)
   throw new Error('Unexpected IBKR historical data');
  const bars=json.data.map((x:Record<string,number>)=>{
   const t=Number(x.t),open=Number(x.o),high=Number(x.h),low=Number(x.l),close=Number(x.c),volume=Number(x.v);
   const day=new Date(t).toISOString().slice(0,10);
   if(!Number.isFinite(t)||!Number.isFinite(Date.parse(day))||
    ![open,high,low,close].every(n=>Number.isFinite(n)&&n>0)||high<Math.max(open,close,low)||low>Math.min(open,close)||
    !Number.isSafeInteger(volume)||volume<0)throw new Error('Invalid IBKR OHLCV');
   return {day,open,high,low,close,volume};
  });
  const db=await pool.connect();let begun=false;
  try{
   await db.query('BEGIN');begun=true;
   for(const b of bars){
    await db.query('INSERT INTO candles(instrument_id,day,open,high,low,close,volume) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(instrument_id,day) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume',[instrument.rows[0].id,b.day,b.open,b.high,b.low,b.close,b.volume]);
   }
   await db.query('COMMIT');begun=false;
  }catch(e){if(begun)await db.query('ROLLBACK');throw e}finally{db.release()}
  return Response.json({ok:true,provider:'IBKR',mode:'READ_ONLY',symbol,count:bars.length,first:bars[0].day,last:bars.at(-1).day});
 }catch(e){return Response.json({error:'Historical sync failed',detail:String(e)},{status:502})}
}
