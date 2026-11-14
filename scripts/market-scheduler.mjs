import pg from 'pg';
import {parisClock,selectMarketBatches} from '../src/market-collection-plan.mjs';

const connectionString=process.env.DATABASE_URL;
const secret=process.env.APP_TOKEN;
const base='http://web:3000';
const maxSymbols=120; // Free-source daily traffic bound. Larger universes rotate.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!connectionString||!secret)throw Error('Scheduler needs internal database and APP_TOKEN');

const pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:8000});
const minuteTime=(clock,at)=>clock.minute>=Number(at.slice(0,2))*60+Number(at.slice(3,5));
const dayOfWeek=clock=>!['Sat','Sun'].includes(clock.weekday);
const fmt=()=>new Date().toISOString();
const safeError=e=>String(e instanceof Error?e.message:e).replace(/apikey=[^&\s]+/gi,'apikey=[REDACTED]').slice(0,600);
const request=async(path,options={})=>{
 const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(105000)});
 const body=await response.json().catch(()=>({error:'Invalid API response'}));
 if(!response.ok)throw Error((body.detail||body.error||'API error')+' (HTTP '+response.status+')');
 return body;
};
async function execute(kind,clock){
 const client=await pool.connect();
 let locked=false,runId=null;
 try{
  const lock=await client.query('SELECT pg_try_advisory_lock(147012) AS ok');
  if(!lock.rows[0].ok)return;
  locked=true;
  const recent=await client.query(`SELECT status,started_at FROM market_job_runs
    WHERE business_day=$1 AND job_type=$2 ORDER BY started_at DESC LIMIT 3`,[clock.day,kind]);
  if(recent.rows.some(r=>r.status==='SUCCESS')||recent.rows.length>=3)return;
  if(recent.rows[0]&&Date.now()-Date.parse(recent.rows[0].started_at)<60*60*1000)return;
  const response=await request('/api/universe');
  const rows=response.batches.flatMap(x=>x.instruments);
  const plan=selectMarketBatches(rows,kind,clock.day,{maxSymbols});
  if(!plan.selected)return;
  const created=await client.query(`INSERT INTO market_job_runs
    (job_type,business_day,status,details) VALUES($1,$2,'RUNNING',$3::jsonb)
    RETURNING id`,[kind,clock.day,JSON.stringify({planned:plan.selected,remaining:plan.remaining})]);
  runId=created.rows[0].id;
  let succeeded=0,failed=0,attempted=0;const errors=[];
  for(const group of plan.groups){
   try{
    const result=await request('/api/market/sync',{
     method:'POST',headers:{'Content-Type':'application/json','x-app-token':secret},
     body:JSON.stringify({symbols:group.symbols,mode:group.mode,scheduled:true})
    });
    succeeded+=result.results.length;
    attempted+=group.symbols.length;
    process.stdout.write(fmt()+' '+kind+' '+group.mode+' '+group.symbols.join(',')+' OK\n');
   }catch(e){
    attempted+=group.symbols.length;
    failed+=group.symbols.length;
    errors.push(group.symbols.join(',')+': '+safeError(e));
    process.stderr.write(fmt()+' '+kind+' '+errors.at(-1)+'\n');
    if(/HTTP 429|HTTP 401|HTTP 403/.test(safeError(e)))break;
   }
   await pause(2500);
  }
  const status=failed===0&&attempted===plan.selected?'SUCCESS':succeeded?'PARTIAL':'FAILED';
  await client.query(`UPDATE market_job_runs SET finished_at=now(),status=$2,
     succeeded_symbols=$3,failed_symbols=$4,attempted_symbols=$5,
     message=$6,details=$7::jsonb WHERE id=$1`,
    [runId,status,succeeded,failed,attempted,errors.join(' | ').slice(0,1800)||null,
     JSON.stringify({planned:plan.selected,remaining:plan.remaining,errors})]);
  process.stdout.write(fmt()+' '+kind+': '+status+' ('+succeeded+'/'+plan.selected+')\n');
 }catch(e){
  process.stderr.write(fmt()+' '+kind+' error: '+safeError(e)+'\n');
  if(runId!==null)await client.query(`UPDATE market_job_runs SET finished_at=now(),
    status='FAILED',message=$2 WHERE id=$1`,[runId,safeError(e)]).catch(()=>{});
 }finally{
  if(locked)await client.query('SELECT pg_advisory_unlock(147012)').catch(()=>{});
  client.release();
 }
}
async function waitForService(){
 for(let i=0;i<90;i++){
  try{await request('/api/universe');return}catch{await pause(2000)}
 }
 throw Error('Web service unavailable after startup');
}
let running=false;
async function tick(){
 if(running)return;
 running=true;
 try{
  const clock=parisClock();
  await execute('BOOTSTRAP',clock);
  if(dayOfWeek(clock)&&minuteTime(clock,'20:45'))await execute('EU_CLOSE',clock);
  if(dayOfWeek(clock)&&minuteTime(clock,'23:15'))await execute('US_CLOSE',clock);
 }catch(e){process.stderr.write(fmt()+' scheduler: '+safeError(e)+'\n')}
 finally{running=false}
}
await waitForService();
process.stdout.write(fmt()+' paper market collector ready; Europe/Paris 20:45 EUR, 23:15 USD; startup history recovery\n');
await tick();
if(process.argv.includes('--once')){
 await pool.end();process.exit(0);
}
setInterval(()=>{void tick()},60000);
process.on('SIGTERM',()=>{void pool.end().finally(()=>process.exit(0))});
