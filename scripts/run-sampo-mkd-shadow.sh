#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/cto-weinstein-trader"
git fetch origin develop >/dev/null
tmp="$(mktemp -d /tmp/weinstein-sampo-XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/src"
for f in src/mkd-legacy-adapter.mjs src/weinstein.mjs src/weinstein-explain.mjs src/weinstein-watch.mjs; do
 git show "origin/develop:$f" > "$tmp/$f"
done
cat > "$tmp/check.mjs" <<'JS'
import {fetchMkdLegacy} from './src/mkd-legacy-adapter.mjs';
import {scanWeinstein} from './src/weinstein.mjs';
import {explainSetup} from './src/weinstein-explain.mjs';
import {assessWatch} from './src/weinstein-watch.mjs';
process.env.MKD_BASE_URL='http://127.0.0.1:8100';
const [asset,bench]=await Promise.all([fetchMkdLegacy('SAMPO.HE'),fetchMkdLegacy('EXSA.DE')]);
if(asset.currency!=='EUR'||bench.currency!=='EUR')throw Error('Unexpected currency');
if(asset.items.length<200||bench.items.length<200)throw Error('Insufficient bars');
const asOf=new Date().toISOString().slice(0,10);
const last=asset.items.at(-1),benchmarkLast=bench.items.at(-1);
const lag=d=>(Date.parse(asOf+'T12:00:00Z')-Date.parse(d+'T12:00:00Z'))/86400000;
const raw=scanWeinstein(asset.items,{asOf,benchmarkDaily:bench.items});
const explained=explainSetup({...raw,lastClose:raw.lastCompletedClose});
const status=lag(last.day)>10?'STALE_DATA':lag(benchmarkLast.day)>10?'STALE_BENCHMARK':null;
const watch=status?null:assessWatch(asset.items,raw,{asOf});
const result={symbol:asset.symbol,currency:asset.currency,source:'MKD_LEGACY_NON_PIT',
 backtestEligible:false,executionAuthorized:false,asOf,bars:asset.items.length,
 lastDay:last.day,benchmark:'EXSA.DE',benchmarkLastDay:benchmarkLast.day,
 status:status??'READ_ONLY',signal:status??explained.signal,
 stage:status?'DATA_UNAVAILABLE':explained.stage,
 eligibleForPaper:false,technicalEligible:!status&&!!explained.eligible,
 setupScore:status?0:explained.setupScore,
 watchStatus:watch?.watchStatus??null,watchScore:watch?.watchScore??null};
console.log(JSON.stringify(result,null,2));
JS
echo '=== SAMPO MKD shadow (read-only; no PAPER) ==='
node "$tmp/check.mjs"
echo '=== No source switch, no DB writes, no local branch changes ==='
