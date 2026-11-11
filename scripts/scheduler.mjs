import {spawnSync} from 'node:child_process';
const tz='Europe/Paris';
let lastRunDate='';
console.log(JSON.stringify({status:'SCHEDULER_STARTED',timeZone:tz,mode:'PAPER',enabled:process.env.PAPER_AUTOMATION_ENABLED==='true'}));
function check(){
 const fields=new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const get=t=>fields.find(x=>x.type===t)?.value;
 const day=get('weekday'),date=[get('year'),get('month'),get('day')].join('-');
 const hour=Number(get('hour')),minute=Number(get('minute'));
 if(!['Mon','Tue','Wed','Thu','Fri'].includes(day)||hour!==8||minute>5||date===lastRunDate)return;
 lastRunDate=date; // no repeated attempts that day; failure must be investigated
 console.log(JSON.stringify({status:'CYCLE_START',date}));
 const run=spawnSync(process.execPath,['scripts/run-paper-cycle.mjs'],{stdio:'inherit',env:process.env,timeout:600000});
 console.log(JSON.stringify({status:run.status===0?'CYCLE_OK':'CYCLE_FAILED',date,exitCode:run.status}));
}
check();setInterval(check,60000);
