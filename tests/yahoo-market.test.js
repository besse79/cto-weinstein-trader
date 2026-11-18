import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooChart,yahooChartUrl,isDailySessionClosed} from '../src/yahoo-market.mjs';
const asOf=new Date('2026-11-12T12:00:00Z');
const days=Array.from({length:80},(_,i)=>{
 const d=new Date(Date.UTC(2026,8,1+i,16));
 return d;
}).filter(d=>d.getUTCDay()>0&&d.getUTCDay()<6);
function fixture({symbol='AC.PA',currency='EUR',timezone='Europe/Paris',timestamps=days.map(d=>Math.floor(+d/1000)),open=days.map(()=>100)}={}){
 const n=timestamps.length;
 return {chart:{result:[{meta:{symbol,currency,exchangeTimezoneName:timezone},timestamp:timestamps,
   indicators:{quote:[{open,high:Array(n).fill(105),low:Array(n).fill(95),close:Array(n).fill(101),volume:Array(n).fill(1200)}]}}],error:null}};
}
test('strict symbol URL uses fixed chart endpoint and five-year daily interval',()=>{
 const url=yahooChartUrl('AC.PA');assert.ok(url.startsWith('https://query1.finance.yahoo.com/v8/finance/chart/AC.PA?'));
 assert.match(url,/range=5y/);assert.match(url,/interval=1d/);
 assert.throws(()=>yahooChartUrl('https://evil.test'));
});
test('valid Yahoo history parses daily EUR bars and discards open session',()=>{
 const data=parseYahooChart(fixture(),{symbol:'AC.PA',currency:'EUR',asOf});
 assert.ok(data.bars.length>=40);
 assert.equal(data.last,'2026-11-11');
 assert.equal(data.provider,'YAHOO_UNOFFICIAL');
 assert.ok(data.bars.every(b=>b.day<'2026-11-12'));
});
test('currency and symbol mismatch block all import',()=>{
 for(const f of [fixture({currency:'USD'}),fixture({symbol:'SPY'})])
 assert.throws(()=>parseYahooChart(f,{symbol:'AC.PA',currency:'EUR',asOf}));
});
test('invalid OHLCV and null columns block all import',()=>{
 const f=fixture();f.chart.result[0].indicators.quote[0].low[2]=110;
 assert.throws(()=>parseYahooChart(f,{symbol:'AC.PA',currency:'EUR',asOf}));
 const g=fixture();g.chart.result[0].indicators.quote[0].close[1]=null;
 assert.throws(()=>parseYahooChart(g,{symbol:'AC.PA',currency:'EUR',asOf}));
});
test('duplicate timestamps, bad metadata and missing data block',()=>{
 const f=fixture();f.chart.result[0].timestamp[2]=f.chart.result[0].timestamp[1];
 assert.throws(()=>parseYahooChart(f,{symbol:'AC.PA',currency:'EUR',asOf}));
 const g=fixture({timezone:'Invalid/Zone'});
 assert.throws(()=>parseYahooChart(g,{symbol:'AC.PA',currency:'EUR',asOf}));
 assert.throws(()=>parseYahooChart({chart:{result:[]}},{symbol:'AC.PA',currency:'EUR',asOf}));
});
test('stale data block instead of silently importing',()=>{
 assert.throws(()=>parseYahooChart(fixture(),{symbol:'AC.PA',currency:'EUR',asOf:new Date('2027-01-12T12:00:00Z')}));
});
test('valid USD symbol supports New York exchange timezone',()=>{
 const result=parseYahooChart(fixture({symbol:'SPY',currency:'USD',timezone:'America/New_York'}),{symbol:'SPY',currency:'USD',asOf});
 assert.equal(result.symbol,'SPY');assert.equal(result.currency,'USD');
});

test('Friday EOD: completed Europe and US daily candles are accepted with buffer',()=>{
 const closed=new Date('2026-11-13T22:50:00Z'); // 23:50 Paris / 17:50 New York
 const eu=parseYahooChart(fixture(),{symbol:'AC.PA',currency:'EUR',asOf:closed});
 const us=parseYahooChart(fixture({symbol:'SPY',currency:'USD',timezone:'America/New_York'}),{
  symbol:'SPY',currency:'USD',asOf:closed
 });
 assert.equal(eu.last,'2026-11-13');
 assert.equal(us.last,'2026-11-13');
 assert.equal(isDailySessionClosed(closed,'America/New_York'),true);
});
test('Friday before safe EOD buffer: both cash markets exclude same-day bars',()=>{
 const europeTooEarly=new Date('2026-11-13T18:10:00Z'); // 19:10 Paris
 const usaTooEarly=new Date('2026-11-13T22:15:00Z'); // 17:15 New York
 assert.equal(isDailySessionClosed(europeTooEarly,'Europe/Paris'),false);
 assert.equal(isDailySessionClosed(usaTooEarly,'America/New_York'),false);
 assert.equal(parseYahooChart(fixture(),{
  symbol:'AC.PA',currency:'EUR',asOf:europeTooEarly
 }).last,'2026-11-12');
 assert.equal(parseYahooChart(fixture({symbol:'SPY',currency:'USD',timezone:'America/New_York'}),{
  symbol:'SPY',currency:'USD',asOf:usaTooEarly
 }).last,'2026-11-12');
});
test('unknown exchanges fail closed on the same trading day',()=>{
 const late=new Date('2026-11-13T23:50:00Z');
 assert.equal(isDailySessionClosed(late,'Europe/Lisbon'),false);
 assert.equal(isDailySessionClosed(late,'Invalid/Zone'),false);
 const data=parseYahooChart(fixture({timezone:'Europe/Lisbon'}),{
  symbol:'AC.PA',currency:'EUR',asOf:late
 });
 assert.equal(data.last,'2026-11-12');
});
test('Saturday contains completed Friday bars without requiring exchange open',()=>{
 const saturday=new Date('2026-11-14T08:00:00Z');
 const eu=parseYahooChart(fixture(),{symbol:'AC.PA',currency:'EUR',asOf:saturday});
 const us=parseYahooChart(fixture({symbol:'SPY',currency:'USD',timezone:'America/New_York'}),{
  symbol:'SPY',currency:'USD',asOf:saturday
 });
 assert.equal(eu.last,'2026-11-13');
 assert.equal(us.last,'2026-11-13');
});

test('London quoted in GBp converts OHLC to GBP, never the volume',()=>{
 const data=parseYahooChart(fixture({symbol:'AZN.L',currency:'GBp',
  timezone:'Europe/London'}),{
  symbol:'AZN.L',currency:'GBP',asOf
 });
 assert.equal(data.symbol,'AZN.L');
 assert.equal(data.currency,'GBP');
 assert.ok(Math.abs(data.bars.at(-1).close-1.01)<1e-8);
 assert.ok(Math.abs(data.bars.at(-1).high-1.05)<1e-8);
 assert.equal(data.bars.at(-1).volume,1200);
 assert.ok(data.adjustment.includes('GBp/GBX'));
});
test('do not accept GBp outside London or silently convert wrong-currency data',()=>{
 const pence=fixture({symbol:'AC.PA',currency:'GBp',timezone:'Europe/Paris'});
 assert.throws(()=>parseYahooChart(pence,{symbol:'AC.PA',currency:'GBP',asOf}),/mismatch/);
 const london=fixture({symbol:'AZN.L',currency:'USD',timezone:'Europe/London'});
 assert.throws(()=>parseYahooChart(london,{symbol:'AZN.L',currency:'GBP',asOf}),/mismatch/);
});
