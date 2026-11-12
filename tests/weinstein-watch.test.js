import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWatch} from '../src/weinstein-watch.mjs';

const week=Array.from({length:50},(_,i)=>{
 const day=new Date(Date.UTC(2026,10,6)- (49-i)*7*86400000).toISOString().slice(0,10);
 return {day,open:99,high:102,low:98,close:100,volume:1200};
});
const scan={weeks:50,ma30:100,maSlope6Pct:1.9,relativeStrength:7.9,volumeRatio:1.38,hasBaseForBreakout:false};
const asOf='2026-11-12';

test('unconfirmed close above previous 26 COMPLETE weeks is provisional, never a buy',()=>{
 const daily=[...week,{day:'2026-11-11',open:101,high:104,low:100,close:103,volume:1250}];
 const r=assessWatch(daily,scan,{asOf});
 assert.equal(r.currentResistance,102);
 assert.equal(r.watchStatus,'PROVISIONAL_BREAKOUT');
 assert.equal(r.provisional,true);
 assert.ok(r.watchScore>=70);
 assert.ok(r.watchReasons.some(s=>s.includes('non confirmée')));
 assert.equal(r.lastCompletedWeek,'2026-11-06');
});

test('close near resistance remains watchlist only and gets nonzero independent score',()=>{
 const daily=[...week,{day:'2026-11-11',open:99,high:102,low:98,close:100,volume:1250}];
 const r=assessWatch(daily,scan,{asOf});
 assert.equal(r.watchStatus,'NEAR_RESISTANCE');
 assert.equal(r.provisional,false);
 assert.ok(r.watchScore>0);
 assert.ok(r.distanceToResistancePct>0);
});

test('last close on the completed week never becomes a provisional breakout',()=>{
 const revised=week.map((b,i)=>i===49?{...b,high:109,close:108}:b);
 const r=assessWatch(revised,scan,{asOf});
 assert.equal(r.provisional,false);
});

test('insufficient history, absent strength, invalid date and missing prices fail closed',()=>{
 assert.equal(assessWatch([],scan,{asOf}).watchScore,null);
 assert.equal(assessWatch(week,{...scan,relativeStrength:null},{asOf}).watchStatus,'UNAVAILABLE');
 assert.equal(assessWatch(week.slice(0,10),scan,{asOf}).watchScore,null);
 assert.throws(()=>assessWatch(week,scan,{asOf:'INVALID'}));
});

test('future-dated daily bar cannot falsely trigger a provisional breakout',()=>{
 const daily=[...week,{day:'2026-11-16',open:199,high:202,low:198,close:201,volume:1000}];
 const r=assessWatch(daily,scan,{asOf});
 assert.equal(r.provisional,false);
 assert.equal(r.latestDaily.day,'2026-11-06');
});
