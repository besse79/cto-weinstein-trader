import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMarketSeries,compareWeinsteinSignals,compareBacktestOutputs} from '../src/mkd-parity.mjs';
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

test('backtest equity, trades and drawdown must match MKD parity input',()=>{
 const base={mode:'PAPER_PORTFOLIO_BACKTEST',initialCash:500,finalCash:520,
  finalEquity:520,returnPct:4,maxDrawdownPct:1.5,tradeCount:1,
  closedPnl:20,symbolsAnalyzed:1,
  equityCurve:[{week:'2026-11-02',cash:500,equity:500,openPositions:0},
   {week:'2026-11-09',cash:520,equity:520,openPositions:0}],
  trades:[{symbol:'AC.PA',signalWeek:'2026-10-19',
   entryWeek:'2026-10-26',exitWeek:'2026-11-09',quantity:1,
   entryPrice:100,exitPrice:120,stop:95,pnl:20,exitReason:'MAX_HOLD'}]
 };
 const matched=compareBacktestOutputs(base,structuredClone(base));
 assert.equal(matched.status,'PARITY_CONFIRMED');
 assert.equal(matched.mutations,0);
 const changed=structuredClone(base);
 changed.equityCurve[1].equity=515;
 changed.trades[0].exitPrice=115;
 changed.maxDrawdownPct=2.5;
 const failed=compareBacktestOutputs(base,changed);
 assert.equal(failed.status,'NO_PARITY');
 assert.ok(failed.differences.some(x=>x.type==='PERFORMANCE_MISMATCH'));
 assert.ok(failed.differences.some(x=>x.type==='EQUITY_CURVE_MISMATCH'));
 assert.ok(failed.differences.some(x=>x.type==='TRADE_MISMATCH'));
});
test('Weinstein signals compare relative strength and MM30, not stage label alone',()=>{
 const original=[{symbol:'HEN3.DE',currency:'EUR',signal:'PHASE2_BREAKOUT',
  stage:'PHASE2_ENTRY',eligible:true,asOf:'2026-11-13',
  benchmark:'EXSA.DE',ma30:80,relativeStrength:24.9,volumeRatio:1.79}];
 const mismatch=[{...original[0],relativeStrength:23.4}];
 const r=compareWeinsteinSignals(original,mismatch);
 assert.equal(r.status,'NO_PARITY');
 assert.ok(r.differences.some(d=>d.field==='relativeStrength'));
});

test('empty inputs cannot certify migration parity',()=>{
 assert.equal(compareMarketSeries([],[]).status,'NO_PARITY');
 assert.equal(compareWeinsteinSignals([],[]).status,'NO_PARITY');
});
test('null and negative data cannot certify parity even if both sources agree',()=>{
 for(const bad of [{close:null},{volume:null},{volume:-1},{close:0}]){
  const row={...bar('2026-11-13'),...bad};
  assert.equal(compareMarketSeries([row],[row]).status,'NO_PARITY');
 }
});
test('duplicate signal cannot silently overwrite a candidate',()=>{
 const row={symbol:'AC.PA'};
 assert.throws(()=>compareWeinsteinSignals([row,row],[row]),/duplicate/);
});

test('invalid dates, coerced numbers and blank symbols cannot certify parity',()=>{
 assert.throws(()=>compareMarketSeries([bar('2026-02-30')],[bar('2026-02-30')]),/Invalid/);
 const valid=bar('2026-11-13');
 for(const bad of [{close:'100'},{volume:'10000'}])assert.equal(compareMarketSeries([valid],[{...valid,...bad}]).status,'NO_PARITY');
 assert.throws(()=>compareWeinsteinSignals([{symbol:' '}],[{symbol:' '}]),/Invalid/);
 const base={mode:'PAPER_PORTFOLIO_BACKTEST',equityCurve:[],trades:[]};
 assert.throws(()=>compareBacktestOutputs(base,base),/required/);
});
