import test from 'node:test';
import assert from 'node:assert/strict';
import {parisClock,selectMarketBatches} from '../src/market-collection-plan.mjs';

const rows=[
 {symbol:'EXSA.DE',currency:'EUR',bars:1200,last_day:'2026-11-13'},
 {symbol:'SPY',currency:'USD',bars:1300,last_day:'2026-11-13'},
 ...Array.from({length:24},(_,i)=>({symbol:'FR'+String(i).padStart(2,'0')+'.PA',
  currency:'EUR',bars:i<20?0:1300,last_day:i<20?null:'2026-11-13'}))
];
test('startup backfills incomplete 5-year histories but avoids recent complete symbols',()=>{
 const p=selectMarketBatches(rows,'BOOTSTRAP','2026-11-14');
 assert.equal(p.selected,20);
 assert.ok(p.groups.every(x=>x.mode==='history'&&x.symbols.length<=6));
 assert.equal(p.groups.flatMap(x=>x.symbols).length,20);
});
test('daily EU and USD jobs cover appropriate exchanges and use delta where possible',()=>{
 const eu=selectMarketBatches(rows,'EU_CLOSE','2026-11-16');
 assert.equal(eu.selected,25);
 assert.ok(!eu.groups.flatMap(x=>x.symbols).includes('SPY'));
 assert.ok(eu.groups.some(g=>g.mode==='delta'&&g.symbols.includes('EXSA.DE')));
 assert.ok(eu.groups.some(g=>g.mode==='history'&&g.symbols.includes('FR00.PA')));
 const us=selectMarketBatches(rows,'US_CLOSE','2026-11-16');
 assert.deepEqual(us.groups,[{mode:'delta',symbols:['SPY']}]);
});
test('low daily cap rotates through wide universes without losing benchmark',()=>{
 const a=selectMarketBatches(rows,'EU_CLOSE','2026-11-16',{maxSymbols:7});
 const b=selectMarketBatches(rows,'EU_CLOSE','2026-11-17',{maxSymbols:7});
 assert.equal(a.selected,7);
 assert.equal(a.remaining,18);
 assert.ok(a.groups.flatMap(g=>g.symbols).includes('EXSA.DE'));
 assert.notDeepEqual(a.groups,b.groups);
});
test('Paris clock accounts for CET/CEST around seasonal switches',()=>{
 const winter=parisClock(new Date('2026-11-16T19:45:00Z'));
 const summer=parisClock(new Date('2026-07-16T18:45:00Z'));
 assert.equal(winter.minute,20*60+45);
 assert.equal(summer.minute,20*60+45);
 assert.equal(winter.weekday,'Mon');
});
test('rejects unsupported and pathological collection plans',()=>{
 assert.throws(()=>selectMarketBatches(rows,'UNKNOWN','2026-11-16'),/Invalid/);
 assert.throws(()=>selectMarketBatches(rows,'EU_CLOSE','2026-11-16',{maxSymbols:1000}),/Invalid/);
});
