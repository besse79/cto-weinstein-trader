/**
 * Read-only W vs MKD live parity gate. No DB writes, no migrations, no trading.
 * Usage: MKD_BASE_URL=http://127.0.0.1:8000 node scripts/mkd-live-parity.mjs AC.PA
 * Requires running Weinstein Docker db and local Next.js scanner on port 3010.
 */
import {execFileSync} from 'node:child_process';
import {fetchMkdLegacy,compareCandleSeries} from '../src/mkd-legacy-adapter.mjs';
import {scanWeinstein} from '../src/weinstein.mjs';
import {explainSetup} from '../src/weinstein-explain.mjs';
const symbol=process.argv[2]??'AC.PA';
const BENCHMARK={EUR:'EXSA.DE',USD:'SPY'};
if(!/^[A-Z0-9.\-]{1,24}$/.test(symbol))throw Error('Invalid symbol');
function query(sql){
 const out=execFileSync('docker',['compose','-p','cto_weinstein','exec','-T','db',
  'psql','-U','trader','-d','trader','-X','-A','-t','-F','\t','-v','ON_ERROR_STOP=1','-c',sql],
  {encoding:'utf8',timeout:60000,maxBuffer:30*1024*1024});
 return out.trim()?out.trim().split('\n').map(line=>line.split('\t')):[];
}
function localInstrument(ticker){
 const rows=query("SELECT id,currency FROM instruments WHERE symbol='"+ticker+"'");
 if(rows.length!==1)throw Error('Missing/ambiguous local instrument '+ticker);
 return {id:rows[0][0],currency:rows[0][1]};
}
function localBars(id){
 return query("SELECT day::text,open::text,high::text,low::text,close::text,volume::text FROM candles WHERE instrument_id="+Number(id)+" AND day<=CURRENT_DATE ORDER BY day")
 .map(([day,open,high,low,close,volume])=>({day,open:Number(open),high:Number(high),low:Number(low),close:Number(close),volume:Number(volume)}));
}
async function main(){
 const info=localInstrument(symbol);
 const benchmark=BENCHMARK[info.currency];
 if(!benchmark)throw Error('Unsupported currency');
 const local=localBars(info.id);
 const mkd=await fetchMkdLegacy(symbol);
 const comparison=compareCandleSeries(local,mkd.items);
 const benchmarkInfo=localInstrument(benchmark);
 const benchmarkLocal=localBars(benchmarkInfo.id);
 const benchmarkMkd=await fetchMkdLegacy(benchmark);
 const benchmarkComparison=compareCandleSeries(benchmarkLocal,benchmarkMkd.items);
 const scannerResponse=await fetch('http://127.0.0.1:3010/api/scanner',{signal:AbortSignal.timeout(60000)});
 if(!scannerResponse.ok)throw Error('Weinstein scanner HTTP '+scannerResponse.status);
 const scanner=await scannerResponse.json();
 const live=scanner.results?.find(r=>r.symbol===symbol);
 if(!live)throw Error('Symbol absent from live scanner');
 const asOf=scanner.asOf;
 const calc=scanWeinstein(mkd.items,{asOf,benchmarkDaily:benchmarkMkd.items});
 const explained=explainSetup({...calc,lastClose:calc.lastCompletedClose});
 const fields=['signal','stage','eligible','setupScore'];
 const fieldsCompared=Object.fromEntries(fields.map(k=>[k,{local:live[k],mkd:(k in explained?explained:calc)[k]}]));
 const fieldsExact=fields.every(k=>fieldsCompared[k].local===fieldsCompared[k].mkd);
 const result={symbol,asOf,source:'MKD_LEGACY_NON_PIT',backtestEligible:false,
  ohlcv:{...comparison,missingInLocal:comparison.missingInLocal.slice(0,10),
   missingInMkd:comparison.missingInMkd.slice(0,10),different:comparison.different.slice(0,10)},
  benchmark:{symbol:benchmark,exact:benchmarkComparison.exact,localBars:benchmarkLocal.length,mkdBars:benchmarkMkd.items.length,
   missingInLocalCount:benchmarkComparison.missingInLocal.length,missingInMkdCount:benchmarkComparison.missingInMkd.length,
   differentCount:benchmarkComparison.different.length},
  fieldsCompared,fieldsExact,
  gatePassed:comparison.exact&&benchmarkComparison.exact&&fieldsExact};
 console.log(JSON.stringify(result,null,2));
 if(!result.gatePassed)process.exitCode=2;
}
main().catch(e=>{console.error('MKD PARITY BLOCKED:',e.message);process.exitCode=1});
