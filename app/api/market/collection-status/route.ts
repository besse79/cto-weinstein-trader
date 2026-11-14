import {pool} from '../../../../lib/db';
export const dynamic='force-dynamic';

/** Read-only status of historical coverage and persistent scheduled-import jobs.
 * Never returns credentials or account/trade data.
 */
export async function GET(){
 try{
  const [coverage,jobs]=await Promise.all([
   pool.query(`SELECT COUNT(*)::int AS instruments,
     COUNT(*) FILTER (WHERE bars>=250)::int AS with_history,
     COUNT(*) FILTER (WHERE bars<250)::int AS needing_history,
     COUNT(*) FILTER (WHERE last_day>=CURRENT_DATE-INTERVAL '4 days')::int AS recent
    FROM (SELECT i.id,COUNT(c.day)::int AS bars,MAX(c.day) AS last_day
     FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id GROUP BY i.id) s`),
   pool.query(`SELECT job_type,business_day::text AS business_day,
    started_at,finished_at,status,succeeded_symbols,failed_symbols,
    attempted_symbols,message,details
     FROM market_job_runs ORDER BY started_at DESC LIMIT 12`)
  ]);
  return Response.json({coverage:coverage.rows[0],jobs:jobs.rows,
   schedule:{timezone:'Europe/Paris',eur:'20:45 weekdays',usd:'23:15 weekdays'},
   reminder:'The Docker scheduler only executes while the Docker engine is running; no broker orders.'},{
    headers:{'Cache-Control':'no-store'}
   });
 }catch(e){return Response.json({error:'Market automation status unavailable',detail:String(e)},{status:503})}
}
