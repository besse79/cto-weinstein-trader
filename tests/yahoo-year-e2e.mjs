/** Exercise the original V4.1 year-window API against an isolated
 * deterministic Yahoo mock before accepting 2025 data in WSL.
 */
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3010';
const token=process.env.APP_TOKEN;
assert.ok(token);
const reply=await fetch(base+'/api/market/sync',{
 method:'POST',headers:{'Content-Type':'application/json','x-app-token':token},
 body:JSON.stringify({symbols:['AC.PA'],mode:'year',year:2025}),
 signal:AbortSignal.timeout(90000)
});
const d=await reply.json();
assert.equal(reply.status,200,JSON.stringify(d));
assert.equal(d.provider,'YAHOO_MOCK');
assert.equal(d.window,'2025');
assert.equal(d.results.length,1);
assert.equal(d.results[0].symbol,'AC.PA');
assert.ok(d.results[0].count>=200&&d.results[0].count<=270);
assert.ok(d.results[0].first.startsWith('2025-'));
assert.ok(d.results[0].last.startsWith('2025-'));
const ps=await fetch(base+'/api/dashboard');
assert.equal(ps.status,200);
const paper=await ps.json();
assert.equal(paper.mode,'PAPER');
assert.equal(paper.cash,500);
assert.equal(paper.orders.length,0);
console.log('PASS 2025 window Yahoo-mock to PostgreSQL with unchanged PAPER account');
