import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayBase,parseIbkrHistory,assertIbkrInstrument} from '../lib/ibkr-readonly.mjs';
const day=(date)=>Date.parse(date+'T16:00:00Z');
const payload={data:[
 {t:day('2026-11-09'),o:100,h:103,l:98,c:102,v:2000},
 {t:day('2026-11-10'),o:102,h:105,l:101,c:104,v:3000}
]};
test('local IBKR gateway canonicalizes Web API base path',()=>{
 assert.equal(gatewayBase('https://host.docker.internal:5000'),'https://host.docker.internal:5000/v1/api');
 assert.equal(gatewayBase('https://127.0.0.1:5000/v1/api'),'https://127.0.0.1:5000/v1/api');
});
test('rejects nonlocal destinations and URL injection',()=>{
 for(const u of ['https://interactivebrokers.com','https://attacker.test','http://127.0.0.1@attacker.test:5000','file:///etc/passwd','http://localhost:5000/iserver/orders','http://localhost:5000/?url=bad'])
 assert.equal(gatewayBase(u),null,u);
});
test('historical bars validated and sorted',()=>{
 const r=parseIbkrHistory({data:[...payload.data].reverse()},{asOf:'2026-11-11'});
 assert.equal(r.length,2);assert.equal(r[0].day,'2026-11-09');assert.equal(r[1].close,104);
});
test('rejects duplicate dates and future bars',()=>{
 assert.throws(()=>parseIbkrHistory({data:[payload.data[0],payload.data[0]]},{asOf:'2026-11-11'}));
 assert.throws(()=>parseIbkrHistory(payload,{asOf:'2026-11-09'}));
});
test('rejects inconsistent high and low and invalid volume',()=>{
 const bad={...payload.data[0],h:99};assert.throws(()=>parseIbkrHistory({data:[bad]},{asOf:'2026-11-11'}));
 const vol={...payload.data[0],v:-1};assert.throws(()=>parseIbkrHistory({data:[vol]},{asOf:'2026-11-11'}));
});
test('rejects empty responses and invalid timestamps',()=>{
 assert.throws(()=>parseIbkrHistory({data:[]},{asOf:'2026-11-11'}));
 assert.throws(()=>parseIbkrHistory({data:[{...payload.data[0],t:0}]},{asOf:'2026-11-11'}));
});

test('IBKR historical metadata matches allowlisted Paris and US symbols',()=>{
 assert.deepEqual(assertIbkrInstrument({symbol:'AC'},'AC.PA'),{appSymbol:'AC.PA',brokerSymbol:'AC'});
 assert.deepEqual(assertIbkrInstrument({symbol:'SPY'},'SPY'),{appSymbol:'SPY',brokerSymbol:'SPY'});
 assert.deepEqual(assertIbkrInstrument({symbol:'EXSA'},'EXSA.DE'),{appSymbol:'EXSA.DE',brokerSymbol:'EXSA'});
});
test('IBKR history rejects absent or incorrect returned symbol',()=>{
 for(const response of [{},{symbol:'AAPL'},{symbol:'AC.PA'},{symbol:''}]) {
   assert.throws(()=>assertIbkrInstrument(response,'AC.PA'));
 }
});
