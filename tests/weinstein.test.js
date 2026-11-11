import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateWeeks,scanWeinstein} from '../src/weinstein.mjs';
function history(n=47,price=(i)=>100+i*.2,volume=(i)=>10000){
 const start=new Date('2025-01-06T12:00:00Z');
 return Array.from({length:n},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+7*i+4);const c=price(i);return {day:d.toISOString().slice(0,10),open:c,high:c+.3,low:c-.3,close:c,volume:volume(i)}})
}
test('daily candles correctly aggregate into ISO weeks',()=>{
 const w=aggregateWeeks([{day:'2026-03-02',open:10,high:11,low:9,close:10,volume:10},{day:'2026-03-06',open:10,high:12,low:9,close:12,volume:20}]);
 assert.equal(w.length,1);assert.equal(w[0].close,12);assert.equal(w[0].volume,30)
});
test('missing history blocks signal',()=>{
 assert.equal(scanWeinstein(history(20),{asOf:'2026-03-02'}).signal,'INSUFFICIENT_HISTORY')
});
test('without benchmark no buy recommendation',()=>{
 const r=scanWeinstein(history(47,i=>i===46?145:100+i*.2,i=>i===46?40000:10000),{asOf:'2026-03-02'});
 assert.equal(r.eligible,false);assert.equal(r.relativeStrength,null);
});
test('strong validated breakout can trigger signal with benchmark',()=>{
 const stock=history(47,i=>i===46?145:100+i*.2,i=>i===46?45000:10000);
 const benchmark=history(47,i=>100+i*.05);
 const r=scanWeinstein(stock,{asOf:'2026-03-02',benchmarkDaily:benchmark});
 assert.equal(r.signal,'PHASE2_BREAKOUT');assert.ok(r.relativeStrength>0);assert.ok(r.volumeRatio>=1.5)
});
test('lack of volume blocks breakout',()=>{
 const r=scanWeinstein(history(47,i=>i===46?145:100+i*.2),{asOf:'2026-03-02',benchmarkDaily:history(47)});
 assert.equal(r.eligible,false)
});
test('partial current week is excluded',()=>{
 const h=history(47);h.push({day:'2026-03-02',open:300,high:350,low:299,close:345,volume:900000});
 const r=scanWeinstein(h,{asOf:'2026-03-03',benchmarkDaily:history(47)});
 assert.equal(r.eligible,false);
});
test('duplicate candles are rejected',()=>{
 const h=history(2);assert.throws(()=>aggregateWeeks([...h,h[0]]))
});
