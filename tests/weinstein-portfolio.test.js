import test from 'node:test';
import assert from 'node:assert/strict';
import {backtestWeinsteinPortfolio} from '../src/weinstein-portfolio.mjs';

function weekly(prices,volumes=prices.map(()=>10000)){
 const start=Date.parse('2023-01-06T12:00:00Z');
 return prices.map((close,i)=>({
  day:new Date(start+i*7*86400000).toISOString().slice(0,10),
  open:close,high:close+.30,low:close-.30,close,volume:volumes[i]
 }));
}
const prices=Array.from({length:110},(_,i)=>i<43?160-i*1.08:113+(i-43)*.08);
prices[80]=118;
const volume=prices.map((_,i)=>i===80?50000:10000);
const benchmark=weekly(prices.map((_,i)=>100+i*.01));
const assets=[{symbol:'A.PA',currency:'EUR',daily:weekly(prices,volume)},
 {symbol:'B.PA',currency:'EUR',daily:weekly(prices.map(x=>x*.52),volume)},
 {symbol:'C.PA',currency:'EUR',daily:weekly(prices.map(x=>x*1.08),volume)},
 {symbol:'D.PA',currency:'EUR',daily:weekly(prices.map(x=>x*1.13),volume)},
 {symbol:'E.PA',currency:'EUR',daily:weekly(prices.map(x=>x*.8),volume)}];
const options={asOf:'2026-01-01',holdWeeks:12};
test('multi-asset V4 shares a SINGLE 500 EUR capital ledger and obeys max four positions',()=>{
 const r=backtestWeinsteinPortfolio(assets,benchmark,options);
 assert.equal(r.mode,'PAPER_PORTFOLIO_BACKTEST');
 assert.equal(r.initialCash,500);
 assert.equal(r.symbolsAnalyzed,5);
 assert.ok(r.orders.some(x=>x.side==='BUY'),'Synthetic breakouts should create purchases');
 assert.ok(r.orders.some(x=>x.side==='SELL'),'Completed synthetic trades should exit');
 assert.ok(r.trades.every(x=>x.entryWeek>x.signalWeek));
 assert.ok(r.equityCurve.every(x=>x.cash>=-1e-8&&x.openPositions<=4));
 assert.ok(r.equityCurve.every(x=>Number.isFinite(x.equity)));
 assert.ok(r.orders.filter(x=>x.side==='BUY').length>=2);
 assert.ok(Number.isFinite(r.finalEquity)&&r.finalEquity>=0);
 assert.ok(r.maxDrawdownPct>=0&&r.maxDrawdownPct<=100);
 assert.deepEqual(r.periods.map(p=>p.name),['EARLY_60','MIDDLE_20','RECENT_20']);
 assert.equal(r.periods.reduce((sum,p)=>sum+p.weeks,0),r.equityCurve.length);
 assert.ok(r.periods.every(p=>p.returnPct===null||Number.isFinite(p.returnPct)));
 assert.ok(r.skipped.some(x=>x.reason==='MAX_POSITIONS')||r.orders.filter(x=>x.side==='BUY').length<=4);
});
test('order/return invariant to input ticker ordering',()=>{
 const a=backtestWeinsteinPortfolio(assets,benchmark,options);
 const b=backtestWeinsteinPortfolio([...assets].reverse(),benchmark,options);
 assert.deepEqual(a,b);
});
test('no benchmark or eligible symbols cannot manufacture orders',()=>{
 const a=backtestWeinsteinPortfolio(assets,[],options);
 assert.equal(a.tradeCount,0);
 assert.equal(a.finalEquity,500);
 assert.deepEqual(a.orders,[]);
 const b=backtestWeinsteinPortfolio([],benchmark,options);
 assert.equal(b.tradeCount,0);
 assert.equal(b.finalEquity,500);
});
test('USD instruments rejected; no FX conversion is invented',()=>{
 const r=backtestWeinsteinPortfolio([{...assets[0],currency:'USD'}],benchmark,options);
 assert.equal(r.symbolsAnalyzed,0);
 assert.equal(r.finalEquity,500);
 assert.ok(r.skipped.some(x=>x.reason==='EUR_ONLY'));
});
test('no same-week or future-data entry; prefix invariance for realized trades',()=>{
 const full=backtestWeinsteinPortfolio(assets,benchmark,options);
 const small=assets.map(a=>({...a,daily:a.daily.slice(0,97)}));
 const prefix=backtestWeinsteinPortfolio(small,benchmark.slice(0,97),options);
 assert.deepEqual(full.trades.filter(t=>t.exitWeek<=prefix.equityCurve.at(-1).week),prefix.trades);
});
test('validates capital, FX, position and horizon parameters',()=>{
 assert.throws(()=>backtestWeinsteinPortfolio(assets,benchmark,{...options,initialCash:0}),/Invalid/);
 assert.throws(()=>backtestWeinsteinPortfolio(assets,benchmark,{...options,holdWeeks:15}),/Invalid/);
 assert.throws(()=>backtestWeinsteinPortfolio(assets,benchmark,{...options,maxPositions:20}),/Invalid/);
 assert.throws(()=>backtestWeinsteinPortfolio([assets[0],assets[0]],benchmark,options),/Duplicate/);
});

test('a disappeared candle in an open position blocks rather than fabricating equity',()=>{
 const altered=assets.map(a=>({...a,daily:[...a.daily]}));
 // Deliberately delete a week after the synthetic breakout for one of the
 // instruments that opens a position; this is a data-integrity failure.
 const baseline=backtestWeinsteinPortfolio(assets,benchmark,options);
 const bought=baseline.orders.find(o=>o.side==='BUY');
 assert.ok(bought);
 const source=altered.find(a=>a.symbol===bought.symbol);
 const ix=source.daily.findIndex(d=>{
  const date=new Date(d.day+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10)===bought.week;
 });
 assert.ok(ix>=0);
 // Remove a subsequent complete week (unless stop closed on entry week).
 const trade=baseline.trades.find(t=>t.symbol===bought.symbol&&t.entryWeek===bought.week);
 if(trade&&trade.exitWeek>bought.week){
  source.daily.splice(ix+1,1);
  assert.throws(()=>backtestWeinsteinPortfolio(altered,benchmark,options),/Missing weekly candle/);
 }
});
