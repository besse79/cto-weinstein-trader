import {pool} from '../../../../lib/db';
export const dynamic='force-dynamic';

/** Read-only diagnostic: dated constituents are not proof of historical membership. */
export async function GET(){
 try{
  const present=await pool.query("SELECT to_regclass('public.index_constituent_observations') IS NOT NULL AS present");
  if(!present.rows[0]?.present) return Response.json({
   status:'NOT_IMPORTED',indices:[],message:'No dated index snapshot has been imported.'
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
     jsonb_object_agg(currency, currency_count) FILTER (WHERE currency_count IS NOT NULL) AS currencies
   FROM (
     SELECT coverage.*,count(*) OVER (PARTITION BY index_code,currency) AS currency_count,
       row_number() OVER (PARTITION BY index_code,currency ORDER BY symbol) AS currency_first
     FROM coverage
   ) c
   GROUP BY index_code,snapshot_day
   ORDER BY index_code`);
  // Use separate query for currency counts to avoid nested/duplicated JSON keys.
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
   constituents:row.constituents,with_history:row.with_history,
   needing_history:row.needing_history,recent:row.recent,
   currencies:Object.fromEntries(currency.rows.filter(c=>c.index_code===row.index_code).map(c=>[c.currency,c.n]))
  }));
  return Response.json({status:'OBSERVED',indices,
   warning:'Constituent snapshots are point-in-time observations only; they do not establish prior historical membership or data licensing.'},
    {headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({error:'Index coverage unavailable'},{status:503});
 }
}
