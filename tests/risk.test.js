import test from 'node:test';
import assert from 'node:assert/strict';
import {POLICY,sizePosition,updatePaperStop} from '../src/risk.mjs';

test('500 EUR limits a 100 EUR trade to one share and 5 EUR risk',()=>{
 const result=sizePosition({equity:500,cash:500,entry:100,initialStop:95});
 assert.equal(result.allowed,true);
 assert.equal(result.quantity,1);
 assert.equal(result.estimatedInitialRisk,5);
});
test('reject position when no whole share affordable',()=>{
 const result=sizePosition({equity:500,cash:500,entry:200,initialStop:190});
 assert.equal(result.allowed,false);
});
test('fractions supported when enabled',()=>{
 const result=sizePosition({equity:500,cash:500,entry:200,initialStop:190,allowFractional:true});
 assert.equal(result.allowed,true);
 assert.equal(result.quantity,0.5);
});
test('break even activates at 1.5R',()=>{
 const result=updatePaperStop({entry:100,initialStop:95,currentStop:95,highestPrice:107.5,lastPrice:107.5,estimatedRoundTripCostsPerShare:0.2});
 assert.equal(result.currentStop,100.2);
 assert.equal(result.mode,'BREAK_EVEN');
});
test('trailing stop never decreases',()=>{
 const result=updatePaperStop({entry:100,initialStop:95,currentStop:107,highestPrice:113,lastPrice:111});
 assert.ok(result.currentStop>=107);
});
test('gap below current stop triggers exit review',()=>{
 const result=updatePaperStop({entry:100,initialStop:95,currentStop:100,highestPrice:110,lastPrice:96});
 assert.equal(result.stopTriggered,true);
});

test('reject buy when four positions already open',()=>{
 const result=sizePosition({equity:500,cash:500,entry:100,initialStop:95,openPositions:4});
 assert.equal(result.allowed,false);
});
test('reject stop at or above entry',()=>{
 const result=sizePosition({equity:500,cash:500,entry:100,initialStop:100});
 assert.equal(result.allowed,false);
});
test('reject negative equity and non-finite values',()=>{
 assert.equal(sizePosition({equity:-500,cash:500,entry:100,initialStop:95}).allowed,false);
 assert.equal(sizePosition({equity:500,cash:500,entry:Infinity,initialStop:95}).allowed,false);
});
test('fees count against maximum risk and available cash',()=>{
 const result=sizePosition({equity:500,cash:500,entry:100,initialStop:95,allowFractional:true,estimatedFees:1});
 assert.equal(result.allowed,true);
 assert.ok(result.estimatedInitialRisk<=5);
});
test('stop does not move before 1.5 R',()=>{
 const result=updatePaperStop({entry:100,initialStop:95,currentStop:95,highestPrice:107,lastPrice:107});
 assert.equal(result.currentStop,95);
});
test('stop is not lowered if last price is below proposed stop',()=>{
 const result=updatePaperStop({entry:100,initialStop:95,currentStop:100,highestPrice:115,lastPrice:99});
 assert.equal(result.currentStop,100);
 assert.equal(result.stopTriggered,true);
});
test('reject inconsistent stop inputs',()=>{
 assert.throws(()=>updatePaperStop({entry:100,initialStop:95,currentStop:94,highestPrice:110,lastPrice:105}));
});
