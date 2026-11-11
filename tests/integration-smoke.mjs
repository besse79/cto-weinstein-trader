import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3010';
const token = process.env.APP_TOKEN;
assert.ok(token, 'APP_TOKEN must be defined');

async function api(path, options={}) {
  const response = await fetch(base+path, {
    ...options,
    headers: { 'Content-Type':'application/json',...(options.headers||{}) },
    signal:AbortSignal.timeout(15000)
  });
  const body=await response.json();
  return {status:response.status, body};
}
function check(condition,description){assert.ok(condition,description);console.log('PASS '+description)}
const auth={'x-app-token':token};
const post=(path,body,headers=auth)=>api(path,{method:'POST',headers,body:JSON.stringify(body)});
const almost=(actual,expected)=>Math.abs(Number(actual)-expected)<0.001;

console.log('Integration testing against '+base);
const home=await fetch(base,{signal:AbortSignal.timeout(15000)});
check(home.ok && (await home.text()).includes('CTO Weinstein Trader'),'Next.js UI serves CTO dashboard');
let r=await api('/api/dashboard');
check(r.status===200 && r.body.mode==='PAPER','Dashboard responds in PAPER mode');
check(almost(r.body.initial,500)&&almost(r.body.cash,500)&&almost(r.body.equity,500),'Capital is initially 500 EUR');
check(r.body.positions.length===0 && r.body.orders.length===0,'Portfolio and ledger are empty');
check(r.body.signals.every(s=>s.status==='NO_CONFIRMED_SIGNAL'),'No fake Weinstein buy signals');
r=await api('/api/scanner');
check(r.status===200 && Array.isArray(r.body.results) && r.body.results.every(x=>!x.eligible && x.signal==='NO_DATA'),'Scanner distinguishes absent market data and blocks every buy');
r=await api('/api/ibkr');
check(r.status===401,'IBKR status needs authorization');
r=await api('/api/ibkr',{headers:auth});
check(r.status===200 && r.body.realOrdersEnabled===false && r.body.localPaperOnly===true,'IBKR never enables live execution');
r=await post('/api/orders',{instrumentId:1,side:'BUY',qty:1,price:100,stop:95,fee:0}, {});
check(r.status===401,'Paper orders reject missing token');
r=await post('/api/orders',{instrumentId:1,side:'BUY',qty:1,price:100,stop:95,fee:0});
check(r.status===400,'Buy blocked without validated fresh market candle');
const date=new Date().toISOString().slice(0,10);
r=await post('/api/import',{symbol:'AC.PA',candles:[{day:date,open:100,high:101,low:99,close:100,volume:20000}]});
check(r.status===200&&r.body.count===1,'Authenticated OHLCV import');
r=await post('/api/orders',{instrumentId:1,side:'BUY',qty:1,price:100,stop:95,fee:0});
check(r.status===200&&r.body.mode==='PAPER','Valid paper buy');
r=await api('/api/dashboard');
check(r.body.positions.length===1&&almost(r.body.cash,400),'Position and cash reflect buy');
check(almost(r.body.positions[0].stop,95),'Initial stop persisted');
r=await post('/api/stops',{},{});
check(r.status===401,'Stops reconciliation requires authorization');
r=await post('/api/stops',{});
check(r.status===200&&r.body.realOrdersEnabled===false&&r.body.results.length===1,'Close-based stops reconcile without broker orders');
r=await post('/api/orders',{instrumentId:1,side:'BUY',qty:1,price:100,stop:95,fee:0});
check(r.status===400,'Duplicate paper position rejected');
r=await post('/api/orders',{instrumentId:1,side:'SELL',qty:2,price:100,fee:0});
check(r.status===400,'Overselling blocked');
r=await post('/api/orders',{instrumentId:1,side:'SELL',qty:1,price:100,fee:0});
check(r.status===200,'Valid paper sell');
r=await api('/api/dashboard');
check(r.body.positions.length===0 && almost(r.body.cash,500),'Round-trip returns 500 EUR with zero fee');
check(r.body.orders.length===2,'Two paper ledger transactions recorded');
console.log('PASS END-TO-END PAPER SMOKE TEST');
