import test from 'node:test';
import assert from 'node:assert/strict';
import {yahooYearWindowUrl} from '../src/yahoo-year-window.mjs';
test('2026 ends on 13 November inclusive, not future sessions',()=>{
 const r=yahooYearWindowUrl('AC.PA',2026);
 const u=new URL(r.url);
 assert.equal(u.searchParams.get('period1'),String(Date.parse('2026-01-01T00:00:00Z')/1000));
 assert.equal(u.searchParams.get('period2'),String(Date.parse('2026-11-14T00:00:00Z')/1000));
});
test('2025 uses full calendar year including December 31',()=>{
 const r=yahooYearWindowUrl('AAPL',2025);
 assert.equal(new URL(r.url).searchParams.get('period2'),String(Date.parse('2026-01-01T00:00:00Z')/1000));
});
test('invalid years and symbols are blocked',()=>{
 assert.throws(()=>yahooYearWindowUrl('BAD /',2026));
 assert.throws(()=>yahooYearWindowUrl('AAPL',2027));
});
