import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLegacyBars,compareCandleSeries,fetchMkdLegacy} from '../src/mkd-legacy-adapter.mjs';

const row=(date='2026-11-13')=>({date,open:10,high:12,low:9,close:11,volume:100,currency:'EUR',provider:'yahoo',quality_status:'legacy_unverified'});
const payload=items=>({point_in_time_verified:false,backtest_eligible:false,items});
test('rejects any claim of PIT certification',()=>{
 assert.throws(()=>normalizeLegacyBars({...payload([row()]),backtest_eligible:true},'EUR'),/provenance/);
 assert.throws(()=>normalizeLegacyBars({...payload([row()]),point_in_time_verified:true},'EUR'),/provenance/);
});
test('rejects wrong currency, provider, invalid prices and duplicate dates',()=>{
 assert.throws(()=>normalizeLegacyBars(payload([{...row(),currency:'USD'}]),'EUR'));
 assert.throws(()=>normalizeLegacyBars(payload([{...row(),provider:'other'}]),'EUR'));
 assert.throws(()=>normalizeLegacyBars(payload([{...row(),low:13}]),'EUR'));
 assert.throws(()=>normalizeLegacyBars(payload([row(),row()]),'EUR'));
});
test('detects price and missing-day differences',()=>{
 const local=[{day:'2026-11-13',open:10,high:12,low:9,close:11,volume:100}];
 assert.equal(compareCandleSeries(local,normalizeLegacyBars(payload([row()]),'EUR')).exact,true);
 assert.deepEqual(compareCandleSeries(local,normalizeLegacyBars(payload([{...row(),close:10}]),'EUR')).different,['2026-11-13']);
});
test('reads year-sliced data, validates symbol and leaves source read-only',async()=>{
 const old=process.env.MKD_BASE_URL;
 process.env.MKD_BASE_URL='http://127.0.0.1:8000';
 const calls=[];
 const fetchImpl=async url=>{
  calls.push(url);
  if(url.includes('/resolve?'))return {ok:true,json:async()=>({symbol:'AC.PA',instrument_id:'00000000-0000-0000-0000-000000000001',currency:'EUR',name:'Accor'})};
  return {ok:true,json:async()=>payload([row(url.includes('start=2025')?'2025-12-30':'2026-11-13')])};
 };
 try{
  const result=await fetchMkdLegacy('AC.PA',{start:'2025-12-01',end:'2026-11-16',fetchImpl});
  assert.equal(result.items.length,2);
  assert.equal(result.backtestEligible,false);
  assert.equal(calls.length,3);
  assert.ok(calls.every(x=>x.startsWith('http://127.0.0.1:8000/')));
 }finally{
  if(old===undefined)delete process.env.MKD_BASE_URL;else process.env.MKD_BASE_URL=old;
 }
});
