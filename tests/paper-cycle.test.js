import test from 'node:test';
import assert from 'node:assert/strict';
import {runPaperCycle} from '../src/paper-cycle.mjs';
const history=s=>({ok:true,provider:'IBKR',mode:'READ_ONLY',symbol:s,count:300,last:'2026-11-10'});
const stops={mode:'PAPER',realOrdersEnabled:false,results:[]};
test('successful ordered sync triggers one paper stop processing',async()=>{
 const calls=[];
 const report=await runPaperCycle({symbols:['AC.PA','SPY'],request:async(path,payload)=>{
  calls.push(path+':'+(payload.symbol||'none'));
  return path==='/api/stops'?stops:history(payload.symbol);
 }});
 assert.deepEqual(calls,['/api/ibkr/history:AC.PA','/api/ibkr/history:SPY','/api/stops:none']);
 assert.equal(report.stopsProcessed,true);
});
test('failed second history import blocks all stop execution',async()=>{
 const calls=[];
 await assert.rejects(runPaperCycle({symbols:['AC.PA','SPY'],request:async(path,payload)=>{
  calls.push(path);
  return payload.symbol==='SPY'?{ok:false}:history(payload.symbol);
 }}));
 assert.deepEqual(calls,['/api/ibkr/history','/api/ibkr/history']);
});
test('transport failure blocks stops',async()=>{
 const calls=[];
 await assert.rejects(runPaperCycle({symbols:['AC.PA'],request:async(path)=>{
  calls.push(path);throw Error('Gateway offline');
 }}));
 assert.deepEqual(calls,['/api/ibkr/history']);
});
test('missing allowlist fails closed',async()=>{
 await assert.rejects(runPaperCycle({symbols:[],request:async()=>stops}));
});
test('duplicates fail closed',async()=>{
 await assert.rejects(runPaperCycle({symbols:['SPY','SPY'],request:async()=>stops}));
});
test('response symbol mismatch cannot trigger stops',async()=>{
 let n=0;
 await assert.rejects(runPaperCycle({symbols:['AC.PA'],request:async()=>{n++;return history('SPY')}}));
 assert.equal(n,1);
});
test('stop result must assert paper only',async()=>{
 await assert.rejects(runPaperCycle({symbols:['AC.PA'],request:async(path,payload)=>
  path==='/api/stops'?{mode:'PAPER',realOrdersEnabled:true,results:[]}:history(payload.symbol)}));
});
