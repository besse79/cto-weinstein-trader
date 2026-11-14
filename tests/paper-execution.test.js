import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePaperBar} from '../src/paper-execution.mjs';
const base={entry:100,initialStop:95,currentStop:95,peakPrice:100};
const bar=(open,high,low,close)=>({open,high,low,close});
test('gap through stop fills at opening price minus slippage',()=>{
 const r=evaluatePaperBar({...base,bar:bar(90,94,88,92)});
 assert.equal(r.action,'EXIT');assert.equal(r.reason,'GAP_THROUGH_STOP');
 assert.equal(r.fill,90*.999);
});
test('intraday touch fills near existing stop, not same-day peak',()=>{
 const r=evaluatePaperBar({...base,bar:bar(100,115,94,112)});
 assert.equal(r.reason,'STOP_TOUCHED');assert.equal(r.fill,95*.999);
});
test('high before low cannot raise and trigger new stop in same bar',()=>{
 const r=evaluatePaperBar({...base,bar:bar(100,115,96,112)});
 assert.equal(r.action,'HOLD');assert.equal(r.nextStop,115*.92);
});
test('break-even activates at 1.5R, effective next day',()=>{
 const r=evaluatePaperBar({...base,bar:bar(100,108,99,107.8),estimatedRoundTripCostsPerShare:.2});
 assert.equal(r.action,'HOLD');assert.equal(r.mode,'BREAK_EVEN');assert.equal(r.nextStop,100.2);
});
test('new stop never decreases',()=>{
 const r=evaluatePaperBar({...base,currentStop:110,peakPrice:118,bar:bar(114,120,111,116)});
 assert.equal(r.action,'HOLD');assert.equal(r.nextStop,110.4);
});
test('new stop above close is deferred',()=>{
 const r=evaluatePaperBar({...base,bar:bar(100,125,96,102)});
 assert.equal(r.action,'HOLD');assert.equal(r.nextStop,95);
});
test('reject invalid candles',()=>{
 assert.throws(()=>evaluatePaperBar({...base,bar:bar(100,101,102,99)}));
});
test('gap opening exactly at stop exits',()=>{
 assert.equal(evaluatePaperBar({...base,bar:bar(95,98,92,96)}).reason,'GAP_THROUGH_STOP');
});
