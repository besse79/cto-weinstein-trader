import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMarketDataSource} from '../src/mkd-source-policy.mjs';
const gate={gatePassed:true,source:'MKD_LEGACY_NON_PIT',backtestEligible:false,
 totals:{failures:0,ohlcvOnly:0,uncovered:0},portfolio:{paperParity:{exact:true}}};
test('LOCAL is the default and needs no MKD availability',()=>{
 assert.equal(resolveMarketDataSource().source,'LOCAL');
});
test('MKD cannot activate without explicit authorization and complete gate',()=>{
 assert.throws(()=>resolveMarketDataSource({requested:'MKD',gate}),/disabled/);
 for(const delta of [
  {gatePassed:false},
  {totals:{...gate.totals,ohlcvOnly:36}},
  {totals:{...gate.totals,uncovered:267}},
  {totals:{...gate.totals,failures:1}},
  {portfolio:{paperParity:{exact:false}}}
 ]){
  assert.throws(()=>resolveMarketDataSource({requested:'MKD',allowMkd:true,gate:{...gate,...delta}}),/blocked/);
 }
});
test('legacy history is forbidden for PIT backtesting even with complete gate',()=>{
 assert.throws(()=>resolveMarketDataSource({requested:'MKD',allowMkd:true,gate,backtest:true}),/backtest prohibited/);
});
test('a complete gate can enable read-only MKD, never execution',()=>{
 assert.deepEqual(resolveMarketDataSource({requested:'MKD',allowMkd:true,gate}),
 {source:'MKD',enabled:true,readOnly:true,backtestEligible:false});
});
