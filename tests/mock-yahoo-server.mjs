import http from 'node:http';
const symbols=new Set(['AC.PA','SU.PA','LR.PA','SAF.PA','EXSA.DE','SPY']);
const today=new Date();today.setUTCHours(0,0,0,0);
let failed='';
const rows=[];
for(let n=1600;n>=1;n--){
 const d=new Date(+today-n*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)rows.push(Math.floor((+d+12*3600000)/1000));
}
function chart(symbol,timestamps=rows){
 const n=timestamps.length,usd=symbol==='SPY';
 return {chart:{error:null,result:[{
  meta:{symbol:failed===symbol?'WRONG.SYMBOL':symbol,
    currency:usd?'USD':'EUR',exchangeTimezoneName:usd?'America/New_York':symbol.endsWith('.DE')?'Europe/Berlin':'Europe/Paris'},
  timestamp:timestamps,
  indicators:{quote:[{
   open:Array.from({length:n},(_,i)=>100+i*.02),
   high:Array.from({length:n},(_,i)=>102+i*.02),
   low:Array.from({length:n},(_,i)=>99+i*.02),
   close:Array.from({length:n},(_,i)=>101+i*.02),
   volume:Array.from({length:n},(_,i)=>15000+i)
  }]}
 }]}}
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url||'/', 'http://localhost');
 const respond=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
 if(req.method!=='GET')return respond(405,{error:'test-only read route'});
 if(u.pathname==='/__test__/fail'){
  failed=u.searchParams.get('symbol')||'';
  return respond(200,{failed});
 }
 const match=/^\/v8\/finance\/chart\/([^/]+)$/.exec(u.pathname);
 if(!match)return respond(404,{error:'unknown route'});
 const symbol=decodeURIComponent(match[1]);
 if(!symbols.has(symbol)||u.searchParams.get('interval')!=='1d')
  return respond(400,{error:'unsupported ticker/interval'});
 const range=u.searchParams.get('range');
 const first=u.searchParams.get('period1');
 const end=u.searchParams.get('period2');
 if(range==='5y'&&!first&&!end)return respond(200,chart(symbol));
 if(!range&&first&&end&&/^\\d{10}$/.test(first)&&/^\\d{10}$/.test(end)&&
    Number(end)>Number(first)&&Number(end)-Number(first)<=370*86400){
   const timestamps=rows.filter(t=>t>=Number(first)&&t<Number(end));
   if(!timestamps.length)return respond(400,{error:'empty historical-year fixture'});
   return respond(200,chart(symbol,timestamps));
 }
 return respond(400,{error:'unsupported query'});
});
server.listen(5056,'0.0.0.0',()=>console.log('Mock Yahoo chart server for isolated CI on 5056'));
process.on('SIGTERM',()=>server.close());
