import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInstrumentDetail} from '../src/instrument-detail.mjs';

function daily(n=62,volume=1200){
 const first=new Date('2025-01-10T12:00:00Z');
 return Array.from({length:n},(_,i)=>{
  const d=new Date(first);d.setUTCDate(d.getUTCDate()+i*7);
  const c=100+i*.2;
  return {day:d.toISOString().slice(0,10),open:c,high:c+2,low:c-2,close:c+1,volume};
 });
}
const asOf='2026-04-01';
test('detail contains only completed weekly OHLCV with 30-week MA and ten-week volume average',()=>{
 const candles=daily();
 candles.push({day:'2026-03-30',open:300,high:320,low:295,close:315,volume:100000});
 const r=buildInstrumentDetail(candles,daily(62,1000),{asOf});
 assert.ok(r.weeks.length>=40);
 assert.ok(r.weeks.every(w=>w.week<'2026-03-30'));
 assert.equal(r.weeks[0].ma30,null);
 assert.ok(r.weeks[29].ma30>0);
 assert.equal(r.weeks[9].volumeAvg10,null);
 assert.equal(r.weeks[10].volumeAvg10,1200);
 assert.ok(r.levels.resistance26>r.levels.support8);
 assert.equal(r.highlight,null,'Unclassified market must not receive fabricated historical phase zones');
});
test('incomplete 40 weeks must not generate fake levels or eligibility',()=>{
 const r=buildInstrumentDetail(daily(15),[],{asOf});
 assert.equal(r.levels,null);
 assert.equal(r.assessment.eligible,false);
 assert.equal(r.assessment.signal,'INSUFFICIENT_HISTORY');
});
test('empty data returns empty series and no artificial phase',()=>{
 const r=buildInstrumentDetail([],[],{asOf});
 assert.deepEqual(r.weeks,[]);
 assert.equal(r.highlight,null);
 assert.equal(r.assessment.eligible,false);
});
test('stage 1 candidate highlights only currently detected base',()=>{
 const c=daily(72);
 for(let i=0;i<72;i++){
  const price=i<45?150-i*1.05:102+(i%4)*.35;
  c[i]={...c[i],open:price,high:price+.3,low:price-.3,close:price};
 }
 const b=daily(72).map((row,i)=>({...row,open:104-i*.08,high:104-i*.08+.3,low:104-i*.08-.3,close:104-i*.08}));
 const r=buildInstrumentDetail(c,b,{asOf:'2026-08-01'});
 assert.equal(r.assessment.signal,'PHASE1_LATE');
 assert.equal(r.highlight.type,'CURRENT_BASE');
 assert.equal(r.assessment.eligible,false);
});
