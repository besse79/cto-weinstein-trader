import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHistoricalPhases} from '../src/weinstein-history.mjs';

function daily(prices,volumes=prices.map(()=>10000)){
 const first=new Date('2023-01-06T12:00:00Z');
 return prices.map((close,i)=>{
  const d=new Date(+first+i*7*86400000);
  return {day:d.toISOString().slice(0,10),open:close,high:close+.3,
   low:close-.3,close,volume:volumes[i]};
 });
}
const prices=Array.from({length:130},(_,i)=>i<42?160-i*1.1:i<91?114+(i%4)*.15:114+(i-90)*.85);
const market=prices.map((_,i)=>100+i*.03);
const asOf='2026-01-01';

test('historical timeline always uses completed ISO weeks and is bounded',()=>{
 const r=analyzeHistoricalPhases(daily(prices),daily(market),{asOf});
 assert.ok(r.weeks.length>=100);
 assert.ok(r.weeks.every(x=>x.week<'2025-12-29'));
 assert.equal(r.weeks[0].phase,'UNCLASSIFIED');
 assert.equal(r.weeks.length,prices.length);
 const total=Object.values(r.counts).reduce((a,b)=>a+b,0);
 assert.equal(total,r.weeks.length);
 assert.ok(r.weeks.every(x=>['PHASE1','PHASE2','PHASE3','PHASE4','UNCLASSIFIED'].includes(x.phase)));
});

test('weekly states cannot use any later weekly observation (prefix invariance)',()=>{
 const full=analyzeHistoricalPhases(daily(prices),daily(market),{asOf});
 const truncated=analyzeHistoricalPhases(daily(prices.slice(0,110)),daily(market.slice(0,110)),{asOf});
 assert.deepEqual(full.weeks.slice(0,110),truncated.weeks);
});

test('future price spike is ignored, including incomplete current week',()=>{
 const base=analyzeHistoricalPhases(daily(prices),daily(market),{asOf});
 const attack=daily(prices);
 attack.push({day:'2026-01-01',open:999,high:1001,low:998,close:1000,volume:1000000});
 attack.push({day:'2026-04-01',open:999,high:1001,low:998,close:1000,volume:1000000});
 const withFuture=analyzeHistoricalPhases(attack,daily(market),{asOf});
 assert.deepEqual(withFuture,base);
});

test('no benchmark never fabricates phase-1/2/3/4 states',()=>{
 const r=analyzeHistoricalPhases(daily(prices),[],{asOf});
 assert.equal(r.counts.UNCLASSIFIED,r.weeks.length);
 assert.equal(r.signals,0);
 assert.ok(r.forwardOutcomes.every(x=>x.samples===0&&x.averageReturnPct===null));
});

test('a weekly volume-confirmed breakout yields descriptive outcomes only when horizon completed',()=>{
 const p=Array.from({length:95},(_,i)=>i<43?160-i*1.08:114+(i%3)*.1);
 p[80]=130;
 const v=p.map((_,i)=>i===80?50000:10000);
 const bm=p.map((_,i)=>100+i*.01);
 const r=analyzeHistoricalPhases(daily(p,v),daily(bm),{asOf});
 assert.ok(r.signals>=1,'synthetic breakout must be recorded');
 assert.ok(r.transitions.some(x=>x.to==='PHASE2'&&x.confirmedBreakout));
 assert.equal(r.forwardOutcomes.length,3);
 for(const x of r.forwardOutcomes){
  assert.ok(x.samples<=r.signals);
  assert.ok(x.positiveRatePct===null||(x.positiveRatePct>=0&&x.positiveRatePct<=100));
 }
});

test('empty and short histories do not crash and never emit a signal',()=>{
 for(const n of [0,10,39]){
  const r=analyzeHistoricalPhases(daily(prices.slice(0,n)),daily(market.slice(0,n)),{asOf});
  assert.equal(r.signals,0);
  assert.ok(r.weeks.every(w=>w.phase==='UNCLASSIFIED'));
 }
});
