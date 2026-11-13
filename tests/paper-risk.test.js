import test from 'node:test';
import assert from 'node:assert/strict';
import {sizePaperPosition,simulateLongStop} from '../src/paper-risk.mjs';
test('500 EUR paper account respects cash, allocation and risk',()=>{
 const r=sizePaperPosition({cash:500,entry:20,stop:18,fee:1});
 assert.equal(r.eligible,true);assert.equal(r.quantity,1);
 assert.ok(r.maxPlannedLoss<=r.riskBudget);assert.ok(r.cashRemaining>=0);
});
test('reject invalid or overextended risk',()=>{
 assert.equal(sizePaperPosition({cash:500,entry:20,stop:20}).eligible,false);
 assert.equal(sizePaperPosition({cash:500,entry:20,stop:19,riskFraction:.5}).eligible,false);
 assert.equal(sizePaperPosition({cash:500,entry:200,stop:195}).eligible,false);
});
test('opening gap below stop fills at open rather than stop',()=>{
 assert.deepEqual(simulateLongStop({stop:18,open:16,low:15,high:17}),
  {triggered:true,fill:16,reason:'OPEN_GAP'});
});
test('intraday stop and invalid OHLC',()=>{
 assert.equal(simulateLongStop({stop:18,open:19,low:17,high:20}).fill,18);
 assert.equal(simulateLongStop({stop:18,open:19,low:20,high:21}).reason,'INVALID_CANDLE');
});
