import {NextRequest} from 'next/server';
import {pool} from '../../../lib/db';
import {authorized} from '../../../lib/auth';
export async function POST(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 let b:Record<string,unknown>;try{b=await req.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 const id=Number(b.instrumentId),qty=Number(b.qty),price=Number(b.price),stop=b.stop==null?null:Number(b.stop),fee=Number(b.fee??0),side=b.side;
 if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(qty)||qty<=0||Math.round(qty*1e6)!==qty*1e6||
 !Number.isFinite(price)||price<=0||!Number.isFinite(fee)||fee<0||!['BUY','SELL'].includes(String(side))||
 stop!==null&&(!Number.isFinite(stop)||stop<=0))
 return Response.json({error:'Invalid order'},{status:400});
 const db=await pool.connect();let started=false;
 try{
  await db.query('BEGIN');started=true;await db.query('SELECT pg_advisory_xact_lock(147001)');
  const instrument=(await db.query('SELECT * FROM instruments WHERE id=$1',[id])).rows[0];
  if(!instrument||instrument.currency!=='EUR')throw new Error('Instrument unavailable or FX not implemented');
  const quote=(await db.query("SELECT day::text AS day,close::float8 AS close FROM candles WHERE instrument_id=$1 ORDER BY day DESC LIMIT 1",[id])).rows[0];
  if(!quote||Date.now()-Date.parse(quote.day+'T23:59:59Z')>4*86400000||Date.parse(quote.day+'T23:59:59Z')>Date.now()+86400000)
   throw new Error('Market data missing, stale or future-dated');
  if(Math.abs(price/Number(quote.close)-1)>0.01)throw new Error('Paper price differs more than 1% from validated last close');
  const orders=(await db.query('SELECT instrument_id,side,qty::float8,price::float8,fee::float8 FROM orders ORDER BY id')).rows;
  const initial=Number((await db.query("SELECT value FROM settings WHERE key='initial_cash'")).rows[0]?.value??500);
  let cash=initial;
  const quantities=new Map<number,number>();
  for(const o of orders){
   const n=Number(o.instrument_id),q=Number(o.qty),total=q*Number(o.price);
   quantities.set(n,(quantities.get(n)||0)+(o.side==='BUY'?q:-q));
   cash+=(o.side==='SELL'?total-Number(o.fee):-total-Number(o.fee));
  }
  const held=quantities.get(id)||0;
  if(side==='BUY'){
   if(held>0)throw new Error('Adding to an existing position is not enabled');
   if(stop===null||stop>=price)throw new Error('Initial stop is required and must be below entry');
   if([...quantities.values()].filter(x=>x>0).length>=4)throw new Error('Max four open positions');
   if(qty*price+fee>cash+1e-8)throw new Error('Insufficient paper cash');
   const quotes=(await db.query("SELECT DISTINCT ON (instrument_id) instrument_id,close::float8 AS close FROM candles ORDER BY instrument_id,day DESC")).rows;
   const qmap=new Map<number,number>(quotes.map(x=>[Number(x.instrument_id),Number(x.close)]));
   let equity=cash;for(const [n,q] of quantities){if(q>0){const px=qmap.get(n);if(!px)throw new Error('Missing portfolio quote');equity+=q*px}}
   if(qty*(price-stop)+fee>equity*0.01+1e-8)throw new Error('Risk exceeds 1% of equity');
   if(qty*price>equity*0.25+1e-8)throw new Error('Position exceeds 25% of equity');
   // Orders are manual paper requests only; the scanner must not authorize purchases before verification.
  }else{
   if(held+1e-8<qty)throw new Error('Not enough shares');
  }
  await db.query('INSERT INTO orders(instrument_id,side,qty,price,fee,stop) VALUES($1,$2,$3,$4,$5,$6)',[id,side,qty,price,fee,stop]);
  if(side==='BUY')await db.query('INSERT INTO risk_stops(instrument_id,initial_stop,current_stop,entry_price,peak_price) VALUES($1,$2,$2,$3,$3)',[id,stop,price]);
  if(side==='SELL'&&Math.abs(qty-held)<1e-8)await db.query('DELETE FROM risk_stops WHERE instrument_id=$1',[id]);
  await db.query('COMMIT');started=false;return Response.json({ok:true,mode:'PAPER'});
 }catch(e){if(started)await db.query('ROLLBACK');return Response.json({error:String(e)},{status:400})}
 finally{db.release()}
}
