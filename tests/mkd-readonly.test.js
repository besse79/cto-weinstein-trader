import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedBaseUrl,fetchMkdBars,fetchMkdFx,getPreviewBars,validateMkdBars,
  validateMkdFx,MkdInvalidData} from '../src/mkd-readonly.mjs';
const asOf='2026-11-15T14:00:00Z';
const now=Date.parse('2026-11-15T17:00:00Z');
const id='00000000-0000-4000-8000-000000000001';
const instrument={instrument_id:id,symbol:'AC.PA',mic:'XPAR',
  name:'Accor',currency:'EUR'};
const validBar={date:'2026-11-13',open:43,high:45,low:42,close:44,volume:10000,
  currency:'EUR',provider:'TEST_FREE_EOD',revision:1,
  published_at:'2026-11-13T21:00:00Z',first_available_at:'2026-11-13T21:00:00Z'};
const ok=(body,status=200)=>({ok:status>=200&&status<300,status,
  json:async()=>body});
function mockFetch(url){
 const u=new URL(url);
 if(u.pathname==='/v1/instruments')return Promise.resolve(ok(instrument));
 if(u.pathname==='/v1/bars')return Promise.resolve(ok({instrument_id:id,items:[validBar]}));
 throw Error('Unexpected endpoint');
}
test('strict read-only MKD bars contract and as_of',async()=>{
 const result=await fetchMkdBars({baseUrl:'http://mkd:8000',symbol:'AC.PA',mic:'XPAR',
   start:'2026-11-11',end:'2026-11-13',asOf,fetchImpl:mockFetch,now});
 assert.equal(result.source,'MKD');
 assert.equal(result.verified,true);
 assert.equal(result.bars[0].close,44);
 assert.equal(result.latest,'2026-11-13');
});
test('currency mismatch and Yahoo-type inconsistent candles reject without any fallback',()=>{
 assert.throws(()=>validateMkdBars({items:[{...validBar,currency:'USD'}]},{
   currency:'EUR',asOf,start:'2026-11-13',end:'2026-11-13'}),MkdInvalidData);
 assert.throws(()=>validateMkdBars({items:[{...validBar,high:43}]},{
   currency:'EUR',asOf,start:'2026-11-13',end:'2026-11-13'}),MkdInvalidData);
});
test('unpublished future prices rejected at point in time',()=>{
 assert.throws(()=>validateMkdBars({items:[{...validBar,
   first_available_at:'2026-11-16T14:00:00Z'}]},{
   currency:'EUR',asOf,start:'2026-11-13',end:'2026-11-13'}),/look-ahead/);
});
test('MKD 404 falls back to identified local bars; no mislabelling',async()=>{
 const localRead=async()=>({currency:'EUR',symbol:'AC.PA',bars:[{day:'2026-11-13'}]});
 const result=await getPreviewBars({enabled:true,baseUrl:'http://mkd:8000',
   symbol:'AC.PA',mic:'XPAR',start:'2026-11-11',end:'2026-11-13',
   asOf,localRead,fetchImpl:async()=>ok({},404),now});
 assert.equal(result.source,'W_LOCAL_FALLBACK');
 assert.equal(result.verified,false);
 assert.match(result.fallbackReason,/MKD_HTTP_404/);
});
test('feature flag off makes no MKD network request',async()=>{
 let requests=0;
 const result=await getPreviewBars({enabled:false,baseUrl:'https://mismatch.invalid',
  symbol:'AC.PA',mic:'XPAR',start:'2026-11-11',end:'2026-11-13',
  asOf,localRead:async()=>({symbol:'AC.PA',bars:[]}),
  fetchImpl:async()=>{requests++;throw Error('Must not fetch MKD')}});
 assert.equal(requests,0);assert.equal(result.source,'W_LOCAL');
 assert.equal(result.mkdEnabled,false);
});
test('invalid MKD data must not fallback silently',async()=>{
 let calls=0;
 await assert.rejects(()=>getPreviewBars({enabled:true,baseUrl:'http://mkd:8000',
   symbol:'AC.PA',mic:'XPAR',start:'2026-11-11',end:'2026-11-13',
   asOf,now,
   localRead:async()=>{calls++;return {}},
   fetchImpl:async url=>{
     if(new URL(url).pathname==='/v1/instruments')return ok(instrument);
     return ok({instrument_id:id,items:[{...validBar,low:46}]});
   }}),MkdInvalidData);
 assert.equal(calls,0);
});
test('MKD origin refuses external plaintext or embedded passwords',()=>{
 assert.equal(checkedBaseUrl('http://mkd:8000'),'http://mkd:8000');
 assert.equal(checkedBaseUrl('http://host.docker.internal:8000'),'http://host.docker.internal:8000');
 assert.throws(()=>checkedBaseUrl('http://evil.example:8000'),/cleartext/);
 assert.throws(()=>checkedBaseUrl('https://a:b@example.org'),/clean/);
});
test('FX EUR/USD PIT uses published_at and first_available_at',async()=>{
 const doc={base:'EUR',quote:'USD',effective_date:'2026-11-13',
   rate:'1.10',provider:'FREE_REFERENCE',revision:1,
   published_at:'2026-11-13T20:00:00Z',
   first_available_at:'2026-11-13T20:00:00Z'};
 const fx=await fetchMkdFx({baseUrl:'http://mkd:8000',date:'2026-11-13',
   asOf,now,fetchImpl:async()=>ok(doc)});
 assert.equal(fx.rate,1.1);
 assert.throws(()=>validateMkdFx({...doc,first_available_at:'2026-11-16T12:00:00Z'},
    {date:'2026-11-13',asOf}),/provenance invalid/);
});
test('reject future as_of and unavailable FX, never infer a default price',async()=>{
 await assert.rejects(()=>fetchMkdFx({baseUrl:'http://mkd:8000',
  date:'2026-11-13',asOf:'2026-11-17T00:00:00Z',
  now,fetchImpl:async()=>{throw Error('Not called')}}),/Future MKD/);
});

test('out-of-order MKD bars fail closed rather than being silently reordered',()=>{
 const later={...validBar,date:'2026-11-14',published_at:'2026-11-14T10:00:00Z',first_available_at:'2026-11-14T10:00:00Z'};
 assert.throws(()=>validateMkdBars({items:[later,validBar]},{
   currency:'EUR',asOf,start:'2026-11-13',end:'2026-11-14'}),/chronological/);
});
