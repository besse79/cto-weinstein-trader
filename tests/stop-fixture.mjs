import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3010';
const auth={'Content-Type':'application/json','x-app-token':process.env.APP_TOKEN};
const post=async(path,obj)=>{const r=await fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(obj)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body};
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const r=await post('/api/orders',{instrumentId:1,side:'BUY',qty:1,price:100,stop:95,fee:0});
assert.equal(r.mode,'PAPER');
// A daily bar prior to the current day, but after the backdated simulated purchase.
await post('/api/import',{symbol:'AC.PA',candles:[{day:yesterday,open:90,high:94,low:88,close:92,volume:30000}]});
console.log('PASS paper fixture prepared for SQL backdate');
