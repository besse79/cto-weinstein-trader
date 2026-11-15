import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMarketSeries,compareWeinsteinSignals} from '../src/mkd-parity.mjs';
const bar=(day,close=100,currency='EUR')=>({day,open:98,high:102,
 low:97,close,volume:10000,currency});
test('W and MKD equivalent 6-decimal vs 8-decimal bars pass strict tolerance',()=>{
 const r=compareMarketSeries([bar('2026-11-13')],[bar('2026-11-13',100.000001)]);
 assert.equal(r.status,'PARITY_CONFIRMED');assert.equal(r.mutations,0);
});
test('missing MKD day, bad volume, wrong currency or price is never parity',()=>{
 const r=compareMarketSeries(
  [bar('2026-11-12'),bar('2026-11-13')],
  [{...bar('2026-11-12'),volume:11000,currency:'USD'}]);
 assert.equal(r.status,'NO_PARITY');
 assert.ok(r.differences.some(x=>x.type==='MISSING_MKD'));
 assert.ok(r.differences.some(x=>x.type==='VOLUME_MISMATCH'));
 assert.ok(r.differences.some(x=>x.type==='CURRENCY_MISMATCH'));
});
test('Weinstein phases and benchmark values require identical conclusions',()=>{
 const a=[{symbol:'AC.PA',currency:'EUR',signal:'PHASE1_LATE',
  stage:'PHASE1_END',eligible:false,asOf:'2026-11-13',benchmark:'EXSA.DE'}];
 assert.equal(compareWeinsteinSignals(a,a).status,'PARITY_CONFIRMED');
 assert.equal(compareWeinsteinSignals(a,[{...a[0],eligible:true}]).status,'NO_PARITY');
});
test('duplicate day causes hard failure rather than silent averaging',()=>{
 assert.throws(()=>compareMarketSeries([bar('2026-11-13'),bar('2026-11-13')],[]),/duplicate/);
});
