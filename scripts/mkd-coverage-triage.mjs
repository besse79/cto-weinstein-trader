/** Read-only coverage triage. Consumes the acceptance report, never inserts missing bars. */
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/mkd-coverage-triage.mjs <acceptance-report.json>');
const r=JSON.parse(readFileSync(file,'utf8'));
if(r.source!=='MKD_LEGACY_NON_PIT'||!Array.isArray(r.results))throw Error('Unexpected report');
const uncovered=r.results.filter(x=>x.kind==='NO_HISTORY').map(x=>x.symbol);
const unsupported=r.results.filter(x=>x.kind==='OHLCV_ONLY_NO_BENCHMARK');
const failures=r.results.filter(x=>x.kind==='ERROR'||x.exact===false||x.signalExact===false);
const summary={generatedAt:new Date().toISOString(),input:file,readOnly:true,
 uncoveredLocalHistory:{count:uncovered.length,symbols:uncovered,
  note:'NO_HISTORY means no local W candles; MKD availability not established'},
 unsupportedBenchmark:{count:unsupported.length,byCurrency:{},symbols:unsupported.map(x=>({symbol:x.symbol,currency:x.currency}))},
 failures,policy:'No automatic backfill, no implicit benchmark substitution, no source switch'};
for(const x of unsupported)summary.unsupportedBenchmark.byCurrency[x.currency]=(summary.unsupportedBenchmark.byCurrency[x.currency]??0)+1;
const out=file.replace(/\.json$/,'-coverage.json');
writeFileSync(out,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output:out,uncovered:uncovered.length,unsupported:unsupported.length,failures:failures.length,byCurrency:summary.unsupportedBenchmark.byCurrency},null,2));
