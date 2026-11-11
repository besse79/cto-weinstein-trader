import {runPaperCycle} from '../src/paper-cycle.mjs';
const endpoint=process.env.PAPER_API_URL || 'http://web:3000';
const token=process.env.APP_TOKEN;
const symbols=(process.env.IBKR_SYNC_SYMBOLS||'').split(',').map(s=>s.trim()).filter(Boolean);
const enabled=process.env.PAPER_AUTOMATION_ENABLED==='true';
if(!enabled) { console.log(JSON.stringify({status:'DISABLED',reason:'PAPER_AUTOMATION_ENABLED not true'}));process.exit(0); }
if(!token || !/^http:\/\/(web|127\.0\.0\.1|localhost)(:\d+)?$/.test(endpoint)){
 console.error('BLOCKED: Missing token or invalid internal API URL');process.exit(1);
}
const request=async(path,body)=>{
 const response=await fetch(endpoint+path,{
  method:'POST',
  headers:{'Content-Type':'application/json','x-app-token':token},
  body:JSON.stringify(body),
  signal:AbortSignal.timeout(45000)
 });
 const data=await response.json();
 if(!response.ok)throw new Error('API failure '+response.status+' '+path);
 return data;
};
try {
 const result=await runPaperCycle({symbols,request,onEvent:e=>console.log(JSON.stringify(e))});
 console.log(JSON.stringify({status:'COMPLETE',...result}));
}catch(e) {
 console.error(JSON.stringify({status:'BLOCKED',message:String(e)}));
 process.exitCode=1;
}
