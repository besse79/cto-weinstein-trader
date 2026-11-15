import test from 'node:test';
import assert from 'node:assert/strict';
import {completedWeekCutoff,scanWeinstein} from '../src/weinstein.mjs';
test('Friday remains incomplete until weekend; Monday uses same last complete week',()=>{
 assert.equal(completedWeekCutoff('2026-11-13'),'2026-11-09');
 assert.equal(completedWeekCutoff('2026-11-14'),'2026-11-16');
 assert.equal(completedWeekCutoff('2026-11-15'),'2026-11-16');
 assert.equal(completedWeekCutoff('2026-11-16'),'2026-11-16');
});
test('Saturday and Monday scan include identical Friday November 13 history',()=>{
 const start=new Date('2025-09-01T12:00:00Z'),daily=[];
 for(let i=0;i<63;i++){
  const d=new Date(start);d.setUTCDate(start.getUTCDate()+7*i+4);
  const close=100+i*.1;
  daily.push({day:d.toISOString().slice(0,10),open:close,high:close+1,low:close-1,close,volume:1000});
 }
 const sat=scanWeinstein(daily,{asOf:'2026-11-14',benchmarkDaily:daily});
 const mon=scanWeinstein(daily,{asOf:'2026-11-16',benchmarkDaily:daily});
 assert.deepEqual(sat,mon);
 assert.equal(sat.asOf,'2026-11-13');
});
test('reject impossible calendar dates',()=>{
 assert.throws(()=>completedWeekCutoff('2026-02-30'),/Invalid/);
});
