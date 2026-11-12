import {pool} from '../../../lib/db';
export const dynamic='force-dynamic';
const core=['EXSA.DE','SPY','AC.PA','LR.PA','SAF.PA','SU.PA'];
/** Public metadata only: never exposes credentials or personal portfolio history. */
export async function GET(){
 try{
  const rows=(await pool.query(`
   SELECT i.symbol,i.name,i.currency,COUNT(c.day)::int AS bars,
          MAX(c.day)::text AS last_day
     FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id
    GROUP BY i.id,i.symbol,i.name,i.currency
    ORDER BY i.symbol`)).rows;
  const coreItems=core.map(symbol=>rows.find((i:{symbol:string})=>i.symbol===symbol))
   .filter(Boolean);
  const extra=rows.filter((i:{symbol:string})=>!core.includes(i.symbol));
  const batches=[coreItems];
  for(let i=0;i<extra.length;i+=6)batches.push(extra.slice(i,i+6));
  return Response.json({count:rows.length,batches:batches.map((items,i)=>({
   id:'batch-'+(i+1),
   name:i===0?'Socle initial + indices':'Actions françaises · lot '+i,
   symbols:items.map((x:{symbol:string})=>x.symbol),
   instruments:items
  }))});
 }catch{return Response.json({error:'Universe unavailable'},{status:503})}
}
