import test from 'node:test';
import assert from 'node:assert/strict';
import {planReverseYearBackfill} from '../src/reverse-year-backfill.mjs';
test('2026 is collected for entire universe before 2025',()=>{
 const rows=Array.from({length:1105},(_,i)=>({symbol:'X'+String(i).padStart(4,'0')}));
 const p=planReverseYearBackfill(rows,{limit:1130});
 assert.equal(p.selected,1130);
 assert.equal(p.batches.filter(x=>x.year===2026).flatMap(x=>x.symbols).length,1105);
 assert.deepEqual(p.batches.at(-1),{year:2025,start:'2025-01-01',end:'2025-12-31',
  symbols:rows.slice(0,25).map(x=>x.symbol)});
 assert.ok(p.batches.every(x=>x.symbols.length<=25));
});
test('verified year is skipped without skipping other years',()=>{
 const p=planReverseYearBackfill([{symbol:'A',verifiedYears:{2026:true}},{symbol:'B'}],{years:[2026,2025]});
 assert.deepEqual(p.batches,[{year:2026,start:'2026-01-01',end:'2026-11-13',symbols:['B']},
  {year:2025,start:'2025-01-01',end:'2025-12-31',symbols:['A','B']}]);
});
test('duplicate symbol fails closed',()=>{
 assert.throws(()=>planReverseYearBackfill([{symbol:'A'},{symbol:'A'}]),/duplicate/);
});
