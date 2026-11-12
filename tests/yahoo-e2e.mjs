import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3010';
const token=process.env.APP_TOKEN;
assert.ok(token);
async function post(path,body,auth=true){
 const r=await fetch(base+path,{method:'POST',
  headers:{'Content-Type':'application/json',...(auth?{'x-app-token':token}:{})},
  body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 return {status:r.status,json:await r.json()};
}
let r=await post('/api/market/sync',{all:true},false);
assert.equal(r.status,401);
r=await post('/api/market/sync',{symbol:'NOTINDB'});
assert.equal(r.status,404);
r=await post('/api/market/sync',{all:true});
assert.equal(r.status,200,JSON.stringify(r));
assert.equal(r.json.provider,'YAHOO_MOCK');
assert.equal(r.json.mode,'PAPER');
assert.equal(r.json.results.length,6);
assert.ok(r.json.total>5000);
for(const item of r.json.results){
 assert.ok(item.count>600,item.symbol);
 assert.ok(item.last<=new Date().toISOString().slice(0,10));
}
const scannerResponse=await fetch(base+'/api/scanner');
assert.equal(scannerResponse.status,200);
const scanner=await scannerResponse.json();
assert.equal(scanner.benchmarkByCurrency.EUR,'EXSA.DE');
assert.equal(scanner.benchmarkByCurrency.USD,'SPY');
assert.equal(scanner.results.length,4);
for(const x of scanner.results){
 assert.equal(x.benchmark,'EXSA.DE');
 assert.notEqual(x.signal,'NO_DATA');
 assert.notEqual(x.signal,'STALE_DATA');
}
const detailResponse=await fetch(base+'/api/instrument/AC.PA');
assert.equal(detailResponse.status,200);
const detail=await detailResponse.json();
assert.equal(detail.instrument.symbol,'AC.PA');
assert.equal(detail.instrument.currency,'EUR');
assert.equal(detail.benchmark,'EXSA.DE');
assert.equal(detail.marketStatus,'READY');
assert.ok(detail.series.length>=100,'Weekly price chart needs at least 100 complete weeks');
assert.ok(detail.series.at(-1).ma30>0);
assert.ok(detail.series.at(-1).volumeAvg10>0);
assert.ok(detail.levels.resistance26>0 && detail.levels.support8>0);
assert.equal(detail.assessment.eligible,false,'Chart must not trigger broker/paper orders');
assert.ok(Array.isArray(detail.assessment.reasons));
assert.ok(detail.explanation.includes('pas une classification rétrospective'));
const missing=await fetch(base+'/api/instrument/UNKNOWN.PA');
assert.equal(missing.status,404);
const bad=await fetch(base+'/api/instrument/%3Cbad%3E');
assert.equal(bad.status,400);
const noHistoryResponse=await fetch(base+'/api/instrument/MC.PA');
assert.equal(noHistoryResponse.status,200);
const noHistory=await noHistoryResponse.json();
assert.equal(noHistory.assessment.signal,'NO_DATA');
assert.equal(noHistory.assessment.eligible,false);
assert.deepEqual(noHistory.series,[]);
console.log('PASS instrument detail weekly chart, price/volume metrics, safe empty market, input validation');
const universe=await (await fetch(base+'/api/universe')).json();
assert.equal(universe.count,6);
assert.equal(universe.batches[0].symbols.length,6);
assert.ok(universe.batches[0].instruments.every(i=>i.bars>600));
r=await post('/api/market/sync',{symbols:['AC.PA','LR.PA']});
assert.equal(r.status,200,'Explicit manual 2-symbol batch must work');
assert.equal(r.json.results.length,2);
r=await post('/api/market/sync',{symbols:['AC.PA','BAD.PA']});
assert.equal(r.status,404,'Unknown member blocks entire batch');
r=await post('/api/market/sync',{symbols:['AC.PA','AC.PA']});
assert.equal(r.status,400,'Duplicate symbols must be refused');
r=await post('/api/market/sync',{symbols:Array(7).fill('AC.PA')});
assert.equal(r.status,400,'No more than six tickers per request');
const dashboard=await (await fetch(base+'/api/dashboard')).json();
assert.equal(dashboard.mode,'PAPER');
assert.equal(dashboard.initial,500);
assert.equal(dashboard.cash,500);
assert.equal(dashboard.orders.length,0);
console.log('PASS 6 symbols, 4 EUR signals, 500 EUR paper capital');
const provider=await fetch('http://127.0.0.1:5056/__test__/fail?symbol=SU.PA');
assert.equal(provider.status,200);
r=await post('/api/market/sync',{all:true});
assert.equal(r.status,502,'Wrong symbol must block full batch');
assert.equal(r.json.paperOnly,true);
console.log('PASS wrong Yahoo ticker prevents batch writes');
