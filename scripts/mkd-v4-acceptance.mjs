/**
 * Trading Factory MKD V4 read-only acceptance gate.
 * Run from an isolated copy of this script and ../src modules.
 * No migrations, DB writes, trading, or automatic source switching.
 */
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fetchMkdLegacy,compareCandleSeries} from '../src/mkd-legacy-adapter.mjs';
import {scanWeinstein} from '../src/weinstein.mjs';
import {explainSetup} from '../src/weinstein-explain.mjs';
import {assessWatch} from '../src/weinstein-watch.mjs';
import {screenPaperCandidates} from '../src/paper-candidates.mjs';

const base=process.env.MKD_BASE_URL??'http://127.0.0.1:8100';
const web=process.env.WEB_BASE_URL??'http://127.0.0.1:3010';
const reportDir=process.env.MKD_REPORT_DIR??'/tmp/mkd-v4-acceptance';
const maxConcurrency=Number(process.env.MKD_CONCURRENCY??'4');
if(!Number.isSafeInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>8)throw Error('MKD_CONCURRENCY must be 1..8');
process.env.MKD_BASE_URL=base;
const benchmarks={EUR:'EXSA.DE',USD:'SPY'};
function query(sql){
 const out=execFileSync('docker',['compose','-p','cto_weinstein','exec','-T','db','psql','-U','trader','-d','trader','-X','-A','-t','-F','|','-v','ON_ERROR_STOP=1','-c',sql],
 {encoding:'utf8',timeout:120000,maxBuffer:60*1024*1024});
 return out.trim()?out.trim().split('\n').map(line=>line.split('|')):[];
}
const safe=s=>{if(!/^[A-Z0-9.\-]{1,24}$/.test(s))throw Error('Invalid symbol');return s};
const instruments=query('SELECT id,symbol,currency,name FROM instruments ORDER BY symbol').map(([id,symbol,currency,name])=>({id:Number(id),symbol:safe(symbol),currency,name}));
const bySymbol=new Map(instruments.map(i=>[i.symbol,i]));
function bars(i){
 return query('SELECT day::text,open::text,high::text,low::text,close::text,volume::text FROM candles WHERE instrument_id='+i.id+' AND day<=CURRENT_DATE ORDER BY day')
 .map(([day,open,high,low,close,volume])=>({day,open:Number(open),high:Number(high),low:Number(low),close:Number(close),volume:Number(volume)}));
}
async function json(path){
 const response=await fetch(web+path,{signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 return response.json();
}
const [scanner,dashboard,paper]=await Promise.all([json('/api/scanner'),json('/api/dashboard'),json('/api/paper-candidates')]);
if(!Array.isArray(scanner.results)||!Array.isArray(paper.candidates))throw Error('Unexpected scanner/PAPER payload');
const localScan=new Map(scanner.results.map(r=>[r.symbol,r]));
const mkdScan=new Map();
const results=[];
const benchmarkData=new Map();
for(const [currency,symbol] of Object.entries(benchmarks)){
 const i=bySymbol.get(symbol);
 if(!i||i.currency!==currency)throw Error('Benchmark missing '+symbol);
 const local=bars(i),mkd=await fetchMkdLegacy(symbol);
 const c=compareCandleSeries(local,mkd.items);
 benchmarkData.set(currency,{symbol,bars:mkd.items,comparison:c});
 results.push({symbol,kind:'BENCHMARK',localBars:c.localBars,mkdBars:c.mkdBars,exact:c.exact,
  missingLocal:c.missingInLocal.length,missingMkd:c.missingInMkd.length,different:c.different.length});
}
const candidates=instruments.filter(i=>!Object.values(benchmarks).includes(i.symbol));
let next=0;
async function worker(){
 while(next<candidates.length){
  const i=candidates[next++];
  try{
   const local=bars(i);
   if(!local.length){results.push({symbol:i.symbol,kind:'NO_HISTORY',localBars:0,skipped:true});continue}
   const mkd=await fetchMkdLegacy(i.symbol);
   if(mkd.currency!==i.currency)throw Error('Currency mismatch');
   const c=compareCandleSeries(local,mkd.items);
   const benchmark=benchmarkData.get(i.currency);
   if(!benchmark)throw Error('Benchmark missing for '+i.currency);
   const raw=scanWeinstein(mkd.items,{asOf:scanner.asOf,benchmarkDaily:benchmark.bars});
   const explained=explainSetup({...raw,lastClose:raw.lastCompletedClose});
   const last=mkd.items.at(-1);
   const lag=last?(Date.parse(scanner.asOf+'T12:00:00Z')-Date.parse(last.day+'T12:00:00Z'))/86400000:Infinity;
   const benchmarkLast=benchmark.bars.at(-1);
   const benchmarkLag=benchmarkLast?(Date.parse(scanner.asOf+'T12:00:00Z')-Date.parse(benchmarkLast.day+'T12:00:00Z'))/86400000:Infinity;
   const status=!last?'NO_DATA':lag>10?'STALE_DATA':!benchmark.bars.length?'NO_BENCHMARK':benchmarkLag>10?'STALE_BENCHMARK':null;
   const watch=status?null:assessWatch(mkd.items,raw,{asOf:scanner.asOf});
   const reconstructed={...raw,...explained,...(watch??{}),
    id:i.id,symbol:i.symbol,name:i.name,currency:i.currency,last:last?{day:last.day,close:last.close}:null,
    eligible:!!explained.eligible&&!status,stage:status?'DATA_UNAVAILABLE':explained.stage,
    stageRank:status?99:explained.stageRank,setupScore:status?0:explained.setupScore,
    signal:status??explained.signal};
   mkdScan.set(i.symbol,reconstructed);
   const live=localScan.get(i.symbol);
   if(!live)throw Error('Missing scanner result');
   const keys=['signal','stage','stageRank','eligible','setupScore','supportCandidate','watchStatus','watchScore','currentResistance','distanceToResistancePct'];
   const mismatches=keys.filter(k=>JSON.stringify(live[k]??null)!==JSON.stringify(reconstructed[k]??null));
   results.push({symbol:i.symbol,kind:'INSTRUMENT',localBars:c.localBars,mkdBars:c.mkdBars,
    exact:c.exact,missingLocal:c.missingInLocal.length,missingMkd:c.missingInMkd.length,different:c.different.length,
    stage:live.stage,signal:live.signal,eligible:live.eligible,signalExact:mismatches.length===0,
    signalDifferences:mismatches});
  }catch(e){results.push({symbol:i.symbol,kind:'ERROR',error:String(e.message??e)})}
 }
}
await Promise.all(Array.from({length:maxConcurrency},()=>worker()));
const ordered=results.sort((a,b)=>a.symbol.localeCompare(b.symbol));
const failures=ordered.filter(r=>r.kind==='ERROR'||(r.exact===false)||(r.signalExact===false));
const uncovered=ordered.filter(r=>r.kind==='NO_HISTORY');
const shadowScanner={...scanner,results:scanner.results.map(r=>mkdScan.get(r.symbol)??r)};
const benchmarkDay=benchmarkData.get('EUR')?.bars.at(-1)?.day??null;
let paperParity={exact:false,error:'Not executed'};
try{
 const shadow=screenPaperCandidates(shadowScanner,dashboard,{asOf:paper.asOf,benchmarkDay});
 const liveCandidates=new Map(paper.candidates.map(c=>[c.symbol,c]));
 const paperFields=['eligible','quantity','stop','quotePrice','maxPlannedLoss','signal','signalWeek','quoteDay','reasons'];
 const differences=[];
 for(const c of shadow.candidates){
  const old=liveCandidates.get(c.symbol);
  if(!old){differences.push({symbol:c.symbol,fields:['missingCandidate']});continue}
  const fields=paperFields.filter(k=>JSON.stringify(c[k]??null)!==JSON.stringify(old[k]??null));
  if(fields.length)differences.push({symbol:c.symbol,fields});
 }
 for(const c of paper.candidates)if(!shadow.candidates.some(x=>x.symbol===c.symbol))differences.push({symbol:c.symbol,fields:['extraCandidate']});
 paperParity={exact:differences.length===0&&shadow.eligibleCount===paper.eligibleCount,
  liveEligible:paper.eligibleCount,shadowEligible:shadow.eligibleCount,differences};
}catch(e){paperParity={exact:false,error:String(e.message??e)}}
const heldSymbols=new Set((dashboard.positions??[]).map(p=>p.symbol));
const held=ordered.filter(r=>heldSymbols.has(r.symbol));
const stages={};
for(const r of ordered.filter(r=>r.kind==='INSTRUMENT'))stages[r.stage]=(stages[r.stage]??0)+1;
const gatePassed=failures.length===0&&paperParity.exact&&uncovered.length===0&&
 ordered.filter(r=>r.kind==='INSTRUMENT').length>0;
const report={generatedAt:new Date().toISOString(),asOf:scanner.asOf,source:'MKD_LEGACY_NON_PIT',
 backtestEligible:false,mode:'READ_ONLY_SHADOW',gatePassed,totals:{localInstruments:instruments.length,
 compared:ordered.filter(r=>r.kind==='INSTRUMENT').length,uncovered:uncovered.length,
 failures:failures.length,stages},held,portfolio:{cash:dashboard.cash,equity:dashboard.equity,
 positions:(dashboard.positions??[]).map(p=>({symbol:p.symbol,qty:p.qty,stop:p.stop,alert:p.alert})),
 paperParity},failures,uncovered,results:ordered};
mkdirSync(reportDir,{recursive:true});
const filename=reportDir+'/mkd-acceptance-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({report:filename,gatePassed,totals:report.totals,paperParity:report.portfolio.paperParity,
 failures:failures.slice(0,15),held},null,2));
if(!gatePassed)process.exitCode=2;
