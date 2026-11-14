import {parisClock} from '../src/market-collection-plan.mjs';
import {pool} from './db';
import {GET as scanner} from '../app/api/scanner/route';
import {GET as dashboard} from '../app/api/dashboard/route';
import {screenPaperCandidates} from '../src/paper-candidates.mjs';

/** Purely server-side candidate computation; not a Next.js route export. */
export async function computeCandidates(){
 const [scannerResponse,dashboardResponse,benchmark]=await Promise.all([
  scanner(),dashboard(),
  pool.query("SELECT c.day::text AS day FROM candles c JOIN instruments i ON i.id=c.instrument_id WHERE i.symbol='EXSA.DE' ORDER BY c.day DESC LIMIT 1")
 ]);
 if(!scannerResponse.ok||!dashboardResponse.ok)
  throw Error('Scanner or portfolio unavailable');
 const [signals,account]=await Promise.all([scannerResponse.json(),dashboardResponse.json()]);
 const asOf=parisClock().day;
 return screenPaperCandidates(signals,account,{asOf,benchmarkDay:benchmark.rows[0]?.day??null});
}
