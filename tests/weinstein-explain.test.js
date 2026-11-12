import test from 'node:test';
import assert from 'node:assert/strict';
import {explainSetup} from '../src/weinstein-explain.mjs';

const valid={signal:'PHASE2_BREAKOUT',stage:'PHASE2_ENTRY',stageRank:1,setupScore:100,eligible:true,
 breakout:true,aboveMa:true,rising:true,volumeRatio:2.0,relativeStrength:7,
 hasBaseForBreakout:true,ma30:100,lastClose:110};

test('fresh stage-2 breakout remains eligible and is explained',()=>{
 const x=explainSetup(valid);
 assert.equal(x.signal,'PHASE2_BREAKOUT');
 assert.equal(x.eligible,true);
 assert.equal(x.stageRank,1);
 assert.equal(x.distanceFromMaPct,10);
 assert.ok(x.reasons.join(' ').includes('confirmés'));
});

test('extended stage-2 breakouts are never marked eligible',()=>{
 const x=explainSetup({...valid,lastClose:125});
 assert.equal(x.signal,'PHASE2_EXTENDED');
 assert.equal(x.stage,'PHASE2_ADVANCED');
 assert.equal(x.eligible,false);
 assert.ok(x.reasons.join(' ').includes('20 %'));
});

test('failing volume and strength have separate explanations',()=>{
 const x=explainSetup({...valid,signal:'WATCH',stage:'UNCLASSIFIED',stageRank:4,setupScore:0,
  eligible:false,volumeRatio:1.1,relativeStrength:-3,breakout:false});
 assert.equal(x.eligible,false);
 assert.ok(x.reasons.some(s=>s.includes('Volume')));
 assert.ok(x.reasons.some(s=>s.includes('Force relative')));
 assert.ok(x.reasons.some(s=>s.includes('résistance')));
});

test('late stage-1 remains watchlist only',()=>{
 const x=explainSetup({...valid,signal:'PHASE1_LATE',stage:'PHASE1_END',stageRank:2,eligible:false,breakout:false});
 assert.equal(x.signal,'PHASE1_LATE');
 assert.equal(x.eligible,false);
 assert.equal(x.stageRank,2);
});

test('missing history or benchmark remain blocked',()=>{
 const x=explainSetup({signal:'INSUFFICIENT_HISTORY',weeks:9,eligible:false});
 assert.equal(x.stageRank,99);
 assert.equal(x.eligible,false);
 const y=explainSetup({signal:'INSUFFICIENT_BENCHMARK',relativeStrength:null,eligible:false});
 assert.equal(y.stage,'DATA_UNAVAILABLE');
});
