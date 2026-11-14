import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePaperMonday} from '../src/monday-preparation.mjs';
const args={asOf:'2026-11-16',capital:500};
test('missing benchmark blocks, never fabricates a trade',()=>{
 const r=preparePaperMonday({...args,instruments:[{symbol:'AC.PA',currency:'EUR',daily:[]}],benchmarks:{}});
 assert.equal(r.blocked,1);assert.equal(r.candidates,0);
 assert.equal(r.rows[0].reason,'BENCHMARK_MISSING');
});
test('empty universe is reported as empty, not as a successful market scan',()=>{
 const r=preparePaperMonday({...args,instruments:[],benchmarks:{}});
 assert.equal(r.universeSize,0);assert.equal(r.candidates,0);
});
test('duplicate symbols are rejected',()=>{
 assert.throws(()=>preparePaperMonday({...args,instruments:[{symbol:'X'},{symbol:'X'}],benchmarks:{}}),/Duplicate/);
});
test('no history does not create a paper order',()=>{
 const r=preparePaperMonday({...args,instruments:[{symbol:'X',currency:'EUR',daily:[]}],benchmarks:{EUR:[{}]}});
 assert.equal(r.rows[0].status,'BLOCKED');
 assert.equal(r.rows[0].reason,'HISTORY_MISSING');
});
