import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooChart,yahooChartUrl} from '../src/yahoo-market.mjs';
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
