import test from 'node:test';
import assert from 'node:assert/strict';
import {screenPaperCandidates} from '../src/paper-candidates.mjs';
import {sizePaperPosition,simulateLongStop} from '../src/paper-risk.mjs';

const asOf='2026-11-16',friday='2026-11-13';
const account={initial:500,cash:500,equity:500,positions:[]};
const candidate=(overrides={})=>({
 id:1,symbol:'TEST.PA',name:'Deterministic paper fixture',currency:'EUR',
 signal:'PHASE2_BREAKOUT',eligible:true,asOf:friday,
 last:{day:friday,close:100},supportCandidate:98,relativeStrength:9,volumeRatio:2,
 ...overrides
});
const run=(rows,portfolio=account,options={})=>
 screenPaperCandidates({results:rows},portfolio,{asOf,benchmarkDay:friday,...options});

test('eligible PAPER buy: one whole share, bounded risk, no execution',()=>{
 const r=run([candidate()]);
 assert.equal(r.mode,'PAPER');
 assert.equal(r.eligibleCount,1);
 const c=r.candidates[0];
 assert.equal(c.eligible,true);
 assert.equal(c.quantity,1);
 assert.equal(c.stop,98);
 assert.equal(c.maxPlannedLoss,3);
 assert.equal(c.quotePrice,100);
 assert.equal(c.signalWeek,'2026-11-09');
 assert.equal(r.cash,500);
 assert.equal(r.positionsOpen,0);
});
test('a completed candle touching stop triggers simulated sale at stop',()=>{
 assert.deepEqual(simulateLongStop({stop:98,open:100,high:101,low:97}),
 {triggered:true,fill:98,reason:'STOP_TOUCHED'});
});
test('gap through stop fills at worse opening price, loss can exceed budget',()=>{
 const fill=simulateLongStop({stop:98,open:92,high:95,low:90});
 assert.deepEqual(fill,{triggered:true,fill:92,reason:'OPEN_GAP'});
 assert.ok(100-fill.fill+1>5);
});
test('position sizing rejects invalid stop, oversized entry, and excess risk',()=>{
 assert.equal(sizePaperPosition({cash:500,entry:100,stop:100,fee:.5}).eligible,false);
 assert.equal(sizePaperPosition({cash:500,entry:200,stop:198,fee:.5}).eligible,false);
 assert.equal(sizePaperPosition({cash:500,entry:100,stop:90,fee:.5}).eligible,false);
});
test('stale data, incomplete week and already-held stock fail closed',()=>{
 const stale=run([candidate({last:{day:'2026-11-09',close:100}})]);
 assert.equal(stale.eligibleCount,0);
 const held=run([candidate()],{...account,positions:[{symbol:'TEST.PA'}]});
 assert.equal(held.eligibleCount,0);
 assert.ok(held.candidates[0].reasons.includes('ALREADY_HELD'));
 const benchmark=run([candidate()],account,{benchmarkDay:'2026-11-12'});
 assert.equal(benchmark.eligibleCount,0);
 assert.ok(benchmark.candidates[0].reasons.includes('PREVIOUS_WEEK_BENCHMARK_INCOMPLETE'));
});
test('non-EUR currency cannot be bought without a verified FX/risk framework',()=>{
 const result=run([candidate({symbol:'AAF.L',currency:'GBP'})]);
 assert.equal(result.eligibleCount,0);
 assert.equal(result.candidates.length,0);
});
