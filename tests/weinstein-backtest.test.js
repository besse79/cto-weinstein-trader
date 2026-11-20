import test from 'node:test';
import assert from 'node:assert/strict';
import {backtestWeinstein} from '../src/weinstein-backtest.mjs';

function weekly(prices,volumes=prices.map(()=>10000)){
 const start=Date.parse('2023-01-06T12:00:00Z');
 return prices.map((close,i)=>{
  const d=new Date(start+i*7*86400000);
  return {day:d.toISOString().slice(0,10),open:close,
   high:close+.30,low:close-.30,close,volume:volumes[i]};
 });
}
const asOf='2026-01-01';
const prices=Array.from({length:102},(_,i)=>i<43?160-i*1.08:113+(i-43)*.08);
prices[80]=130;
const volumes=prices.map((_,i)=>i===80?50000:10000);
const benchmark=prices.map((_,i)=>100+i*.01);

test('500 EUR paper position sizing, no broker orders and no same-week entries',()=>{
 const r=backtestWeinstein(weekly(prices,volumes),weekly(benchmark),{asOf,holdWeeks:12,fee:.5});
 assert.equal(r.initialCash,500);
 assert.equal(r.mode,'PAPER_BACKTEST');
 assert.ok(r.confirmedSignals>=1);
 assert.ok(r.trades.length>=1,'Expected one synthetic Weinstein breakout to have next-week entry');
 assert.ok(r.trades.every(t=>t.entryWeek>t.signalWeek));
 assert.ok(r.trades.every(t=>t.entryCost<=125.01));
 assert.ok(r.trades.every(t=>t.quantity>=1));
 assert.ok(r.trades.every(t=>t.exitWeek>=t.entryWeek));
 assert.ok(Number.isFinite(r.endCash));
 assert.ok(Number.isFinite(r.maxDrawdownPct));
 assert.ok(r.disclaimers.some(x=>x.includes('survivorship')));
});

test('next week missing blocks entry, no artificial profit',()=>{
 const r=backtestWeinstein(weekly(prices.slice(0,81),volumes.slice(0,81)),
   weekly(benchmark.slice(0,81)),{asOf,holdWeeks:4});
 assert.ok(r.confirmedSignals>=1);
 assert.equal(r.tradeCount,0);
 assert.equal(r.endCash,500);
 assert.ok(r.skipped.some(x=>x.reason==='NO_NEXT_WEEK'));
});

test('future candle cannot change earlier completed outcomes',()=>{
 const a=backtestWeinstein(weekly(prices,volumes),weekly(benchmark),{asOf,holdWeeks:4});
 const pricesFuture=prices.concat([9999]);
 const vFuture=volumes.concat([1000000]);
 // Date 2024.. past, so prefix invariance compares the outcomes of trades
 // closed before the appended complete week, not the trade opportunity count.
 const b=backtestWeinstein(weekly(pricesFuture,vFuture),weekly(benchmark.concat([110])),
  {asOf,holdWeeks:4});
 assert.deepEqual(b.trades.filter(t=>t.exitWeek<=a.trades.at(-1)?.exitWeek),a.trades);
});

test('parameter validation and untrusted OHLCV reject safely',()=>{
 assert.throws(()=>backtestWeinstein([],[],{holdWeeks:100}),/Invalid backtest/);
 assert.throws(()=>backtestWeinstein([],[],{initialCash:0}),/Invalid backtest/);
 const bad=weekly(prices);bad[5].low=bad[5].high+1;
 assert.throws(()=>backtestWeinstein(bad,weekly(benchmark),{asOf}),/Invalid OHLCV/);
});

test('no reference means no historical stage-2 entries or P&L',()=>{
 const r=backtestWeinstein(weekly(prices,volumes),[],{asOf});
 assert.equal(r.confirmedSignals,0);
 assert.equal(r.tradeCount,0);
 assert.equal(r.endCash,500);
 assert.equal(r.returnPct,0);
});

test('horizons 4, 8, 12 and 26 produce finite bounded paper results',()=>{
 for(const holdWeeks of [4,8,12,26]){
  const r=backtestWeinstein(weekly(prices,volumes),weekly(benchmark),{asOf,holdWeeks});
  assert.equal(r.holdWeeks,holdWeeks);
  assert.ok(Number.isFinite(r.endCash));
  assert.ok(r.maxDrawdownPct>=0&&r.maxDrawdownPct<=100);
  assert.ok(r.trades.every(t=>t.holdingWeeks<=holdWeeks));
 }
});
