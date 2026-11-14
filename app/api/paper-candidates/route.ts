import {pool} from '../../../lib/db';
import {GET as scanner} from '../scanner/route';
import {GET as dashboard} from '../dashboard/route';
import {screenPaperCandidates} from '../../../src/paper-candidates.mjs';

export const dynamic='force-dynamic';
export async function computeCandidates(){
 const [scannerResponse,dashboardResponse,benchmark]=await Promise.all([
  scanner(),dashboard(),
  pool.query("SELECT c.day::text AS day FROM candles c JOIN instruments i ON i.id=c.instrument_id WHERE i.symbol='EXSA.DE' ORDER BY c.day DESC LIMIT 1")
 ]);
 if(!scannerResponse.ok||!dashboardResponse.ok)
  throw Error('Scanner or portfolio unavailable');
 const [signals,account]=await Promise.all([scannerResponse.json(),dashboardResponse.json()]);
 const asOf=new Date().toISOString().slice(0,10);
 return screenPaperCandidates(signals,account,{asOf,benchmarkDay:benchmark.rows[0]?.day??null});
}
export async function GET(){
 try{
  const result=await computeCandidates();
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  return Response.json({error:'Paper candidate screening unavailable',detail:String(e)},{status:503});
 }
}
