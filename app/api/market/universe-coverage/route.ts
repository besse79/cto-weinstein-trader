import {pool} from '../../../../lib/db';
import {parisClock} from '../../../../src/market-collection-plan.mjs';
export const dynamic='force-dynamic';

/** Read-only diagnostic: dated constituents are not proof of historical membership. */
export async function GET(){
 try{
  const paris=parisClock();
  const date=new Date(paris.day+'T12:00:00Z');
  const weekday=date.getUTCDay();
  const daysBack=weekday===6?1:weekday===0?2:weekday+2;
  const priorFriday=new Date(date.getTime()-daysBack*86400000).toISOString().slice(0,10);
  const present=await pool.query("SELECT to_regclass('public.index_constituent_observations') IS NOT NULL AS present");
  if(!present.rows[0]?.present) return Response.json({
   status:'NOT_IMPORTED',indices:[],priorFriday, message:'No dated index snapshot has been imported.'
  },{headers:{'Cache-Control':'no-store'}});
  const result=await pool.query(`
   WITH latest AS (
     SELECT index_code,MAX(observed_on) AS snapshot_day
     FROM index_constituent_observations GROUP BY index_code
   ), coverage AS (
     SELECT o.index_code,l.snapshot_day,i.symbol,i.currency,
            count(c.day)::int AS bars,max(c.day) AS last_day
     FROM latest l JOIN index_constituent_observations o
       ON o.index_code=l.index_code AND o.observed_on=l.snapshot_day
     JOIN instruments i ON i.id=o.instrument_id
     LEFT JOIN candles c ON c.instrument_id=i.id
     GROUP BY o.index_code,l.snapshot_day,i.symbol,i.currency
   )
   SELECT index_code,snapshot_day::text AS snapshot_day,
     count(*)::int AS constituents,
     count(*) FILTER (WHERE bars>=250)::int AS with_history,
     count(*) FILTER (WHERE bars<250)::int AS needing_history,
     count(*) FILTER (WHERE last_day>=CURRENT_DATE-INTERVAL '4 days')::int AS recent,
     count(*) FILTER (WHERE bars>=750)::int AS with_three_years,
     count(*) FILTER (WHERE last_day=$1::date)::int AS with_friday_close
   FROM coverage
   GROUP BY index_code,snapshot_day
   ORDER BY index_code`,[priorFriday]);
  // Currency distribution is kept separate from the OHLCV coverage aggregate.
  const currency=await pool.query(`
   WITH latest AS (
     SELECT index_code,MAX(observed_on) AS day FROM index_constituent_observations GROUP BY index_code
   )
   SELECT o.index_code,i.currency,count(*)::int AS n
   FROM index_constituent_observations o JOIN latest l
     ON l.index_code=o.index_code AND l.day=o.observed_on
   JOIN instruments i ON i.id=o.instrument_id
   GROUP BY o.index_code,i.currency ORDER BY o.index_code,i.currency`);
  const indices=result.rows.map(row=>({
   index_code:row.index_code,snapshot_day:row.snapshot_day,
   constituents:row.constituents,with_history:row.with_history,with_three_years:row.with_three_years,
   needing_history:row.needing_history,recent:row.recent,
   with_friday_close:row.with_friday_close,
   fridayCoveragePct:row.constituents>0?Math.round(row.with_friday_close/row.constituents*10000)/100:0,
   readyForWeekendReview:row.constituents>0&&row.with_friday_close/row.constituents>=0.95&&row.with_history/row.constituents>=0.95,
   currencies:Object.fromEntries(currency.rows.filter(c=>c.index_code===row.index_code).map(c=>[c.currency,c.n]))
  }));
  return Response.json({status:'OBSERVED',priorFriday,indices,
   warning:'Constituent snapshots are point-in-time observations only; they do not establish prior historical membership or data licensing.'},
    {headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({error:'Index coverage unavailable'},{status:503});
 }
}
