import assert from 'node:assert/strict';
const root=process.env.TEST_BASE_URL||'http://127.0.0.1:3010';
const token=process.env.APP_TOKEN;
assert.ok(token);
async function request(path,body,authorized=true){
 const response=await fetch(root+path,{
  method:body===undefined?'GET':'POST',
  headers:{'Content-Type':'application/json',...(authorized?{'x-app-token':token}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(20000)
 });
 return {status:response.status,body:await response.json()};
}
const status=await request('/api/ibkr',undefined);
assert.equal(status.status,200);
assert.equal(status.body.mode,'READ_ONLY');
assert.equal(status.body.ibkr.connected,true);
assert.equal(status.body.realOrdersEnabled,false);
const contracts=await request('/api/ibkr/contracts?symbol=AC.PA',undefined);
assert.equal(contracts.status,200,JSON.stringify(contracts));
assert.equal(contracts.body.mode,'READ_ONLY');
assert.equal(contracts.body.needsManualVerification,true);
assert.equal(contracts.body.candidates[0].conid,1001);
const unauthorizedContracts=await request('/api/ibkr/contracts?symbol=AC.PA',undefined,false);
assert.equal(unauthorizedContracts.status,401);
const notListed=await request('/api/ibkr/contracts?symbol=BAD',undefined);
assert.equal(notListed.status,404);
const denied=await request('/api/ibkr/history',{symbol:'AC.PA'},false);
assert.equal(denied.status,401);
const invalid=await request('/api/ibkr/history',{symbol:'NOT.ALLOWED'});
assert.equal(invalid.status,400);
for(const symbol of ['AC.PA','SPY']){
 const result=await request('/api/ibkr/history',{symbol});
 assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.body.mode,'READ_ONLY');
 assert.equal(result.body.provider,'IBKR');
 assert.equal(result.body.symbol,symbol);
 assert.equal(result.body.count,300);
 console.log('PASS IBKR simulated history import '+symbol);
}
const scanner=await request('/api/scanner');
assert.equal(scanner.status,200,JSON.stringify(scanner));
assert.equal(scanner.body.results.some(r=>r.symbol==='AC.PA'),true);
assert.equal(scanner.body.results.every(r=>r.eligible===false),true);
console.log('PASS broker status, credential isolation, contract allowlist, PostgreSQL history import, stale-signal block');
