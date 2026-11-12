import http from 'node:http';
const DATA_START=Date.parse('2025-01-02T16:00:00Z');
let calls=0;
const bars=Array.from({length:300},(_,i)=>{
 const t=DATA_START+i*86400000, p=100+i*.1;
 return {t,o:p,h:p+1,l:p-1,c:p+.2,v:10000+i};
});
const server=http.createServer((req,res)=>{
 const path=new URL(req.url||'/', 'http://localhost');
 const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
 if(path.pathname==='/v1/api/iserver/auth/status' && req.method==='POST')return json(200,{success:{value:{authenticated:true,connected:true,established:true}}});
 if(req.method!=='GET')return json(405,{error:'read-only mock'});
 if(path.pathname==='/v1/api/iserver/secdef/search'){
   const symbol=path.searchParams.get('symbol');
   if(symbol==='AC')return json(200,[{conid:1001,symbol:'AC',companyName:'ACCOR',description:'SBF',sections:[{secType:'STK',exchange:'SBF;'}]}]);
   if(symbol==='SPY')return json(200,[{conid:1002,symbol:'SPY',companyName:'SPDR S&P 500 ETF',description:'ARCA',sections:[{secType:'STK',exchange:'ARCA;'}]}]);
   return json(200,[]);
 }

 if(path.pathname==='/v1/api/iserver/marketdata/history'){
   calls++;
   if(!['1001','1002'].includes(path.searchParams.get('conid')))return json(404,{error:'unrecognized conid'});
   if(path.searchParams.get('bar')!=='1d')return json(400,{error:'bar must be daily'});
   return json(200,{symbol:path.searchParams.get('conid')==='1001'?'AC':'SPY',data:bars});
 }
 return json(404,{error:'unsupported endpoint'});
});
server.listen(5055,'0.0.0.0',()=>console.log('Mock IBKR Client Portal read-only gateway listening on port 5055'));
process.on('SIGTERM',()=>server.close());
