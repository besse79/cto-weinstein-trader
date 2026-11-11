import {pool} from '../../../lib/db';
export const dynamic='force-dynamic';
export async function GET(){
 try {
  const initial=Number((await pool.query("SELECT value FROM settings WHERE key='initial_cash'")).rows[0]?.value ?? 500);
  const orders=(await pool.query("SELECT o.*,i.symbol,i.name FROM orders o JOIN instruments i ON i.id=o.instrument_id ORDER BY o.id")).rows;
  const candles=(await pool.query("SELECT DISTINCT ON (instrument_id) instrument_id,day::text AS day,close::float8 AS close FROM candles ORDER BY instrument_id,day DESC")).rows;
  const last=new Map<number,{day:string,close:number}>(candles.map(c=>[Number(c.instrument_id),{day:c.day,close:Number(c.close)}]));
  const stops=(await pool.query("SELECT * FROM risk_stops")).rows;
  const stopMap=new Map<number,number>(stops.map(s=>[Number(s.instrument_id),Number(s.current_stop)]));
  let cash=initial;
  const holdings=new Map<number,{id:number,symbol:string,name:string,qty:number,cost:number}>();
  for(const o of orders){
   const id=Number(o.instrument_id),q=Number(o.qty),price=Number(o.price),fee=Number(o.fee);
   const h=holdings.get(id)||{id,symbol:o.symbol,name:o.name,qty:0,cost:0};
   if(o.side==='BUY'){h.qty+=q;h.cost+=q*price+fee;cash-=q*price+fee}
   else{const avg=h.qty?h.cost/h.qty:0;h.qty-=q;h.cost-=q*avg;cash+=q*price-fee}
   holdings.set(id,h);
  }
  const positions=[...holdings.values()].filter(h=>h.qty>0).map(h=>{
   const quote=last.get(h.id);const stop=stopMap.get(h.id)??null;
   return {...h,avg:h.cost/h.qty,last:quote?.close??null,quoteDate:quote?.day??null,stop,
    alert:quote&&stop!==null&&quote.close<=stop?'SELL_REVIEW':'HOLD'};
  });
  const instruments=(await pool.query("SELECT id,symbol,name,currency FROM instruments ORDER BY symbol")).rows;
  const signals=instruments.map(i=>({id:Number(i.id),symbol:i.symbol,name:i.name,currency:i.currency,
   last:last.get(Number(i.id))??null,status:'NO_CONFIRMED_SIGNAL'}));
  const equity=cash+positions.reduce((n,h)=>n+(h.last??h.avg)*h.qty,0);
  return Response.json({mode:'PAPER',initial,cash,equity,positions,signals,orders:orders.slice(-30).reverse()});
 }catch(e){return Response.json({error:'Database unavailable',detail:String(e)},{status:503})}
}
