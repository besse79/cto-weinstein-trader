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
