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
