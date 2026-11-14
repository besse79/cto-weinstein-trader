import test from 'node:test';
import assert from 'node:assert/strict';
import {screenPaperCandidates} from '../src/paper-candidates.mjs';

const friday='2026-11-13',monday='2026-11-16';
const make=(symbol='AC.PA',options={})=>({
 id:1,symbol,name:'Fixture',currency:'EUR',signal:'PHASE2_BREAKOUT',
 eligible:true,asOf:friday,last:{day:friday,close:100},
 supportCandidate:98,relativeStrength:7,volumeRatio:1.7,...options
});
const account={initial:500,cash:500,equity:500,positions:[]};
const scan=results=>({results});
const run=(results,other={})=>screenPaperCandidates(scan(results),account,
 {asOf:monday,benchmarkDay:friday,...other});
test('Monday: accepts only completed previous week stage 2, sizes whole shares',()=>{
 const r=run([make()]);
 assert.equal(r.eligibleCount,1);
 assert.equal(r.candidates[0].quantity,1);
 assert.equal(r.candidates[0].maxPlannedLoss,3);
 assert.equal(r.signalWeekExpected,'2026-11-09');
 assert.equal(r.candidates[0].quoteDay,friday);
 assert.equal(r.candidates[0].quotePrice,100);
});
test('no confirmed breakout, no paper order even for a strong phase-one watch',()=>{
 const r=run([make('AC.PA',{signal:'PHASE1_LATE',eligible:false})]);
 assert.equal(r.eligibleCount,0);
 assert.ok(r.candidates[0].reasons.includes('NO_CONFIRMED_BREAKOUT'));
});
test('historic signal cannot be bought later, despite eligible flag',()=>{
 const r=run([make('AC.PA',{asOf:'2026-11-06'})]);
 assert.equal(r.eligibleCount,0);
 assert.ok(r.candidates[0].reasons.includes('SIGNAL_NOT_PREVIOUS_WEEK'));
});
test('stale quote or benchmark blocks ALL orders',()=>{
 const a=run([make('AC.PA',{last:{day:'2026-11-09',close:100}})]);
 assert.equal(a.eligibleCount,0);
 assert.ok(a.candidates[0].reasons.includes('QUOTE_STALE'));
 const b=run([make()],{benchmarkDay:'2026-11-09'});
 assert.equal(b.eligibleCount,0);
 assert.ok(b.candidates[0].reasons.includes('BENCHMARK_STALE'));
});
test('no buys on held position or full portfolio',()=>{
 const held=screenPaperCandidates(scan([make()]),{
  ...account,positions:[{symbol:'AC.PA'}]},
  {asOf:monday,benchmarkDay:friday});
 assert.equal(held.eligibleCount,0);
 assert.ok(held.candidates[0].reasons.includes('ALREADY_HELD'));
 const full=screenPaperCandidates(scan([make()]),{
  ...account,positions:[{symbol:'A'},{symbol:'B'},{symbol:'C'},{symbol:'D'}]},
  {asOf:monday,benchmarkDay:friday});
 assert.equal(full.eligibleCount,0);
 assert.ok(full.candidates[0].reasons.includes('MAX_POSITIONS'));
});
test('no fractional trades or cash overspend; USD blocked',()=>{
 const r=run([make('EXP.PA',{last:{day:friday,close:250},supportCandidate:248}),
  make('SPY',{currency:'USD'})]);
 assert.equal(r.eligibleCount,0);
 assert.ok(r.candidates.every(c=>!c.eligible));
});
test('invalid screening arguments fail closed',()=>{
 assert.throws(()=>run([make()],{asOf:'bad'}),/Invalid/);
 assert.throws(()=>screenPaperCandidates(scan([make()]),{cash:NaN,positions:[]},
  {asOf:monday,benchmarkDay:friday}),/Invalid/);
});
