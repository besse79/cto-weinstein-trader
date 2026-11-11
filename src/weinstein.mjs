/**
 * Conservative, weekly, close-confirmed Weinstein breakout scanner.
 * No prediction, no intraweek signal, no fabricated market data.
 */
const positive=x=>Number.isFinite(x)&&x>0;
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
export function aggregateWeeks(daily){
  if(!Array.isArray(daily))throw new Error('Candles required');
  const rows=[...daily].sort((a,b)=>String(a.day).localeCompare(String(b.day)));
  const groups=new Map();
  for(const c of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(c.day))||!Number.isFinite(Date.parse(c.day+'T12:00:00Z'))||
      ![c.open,c.high,c.low,c.close].every(positive)||!Number.isSafeInteger(c.volume)||c.volume<0||
      c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close))throw new Error('Invalid OHLCV');
    const d=new Date(c.day+'T12:00:00Z');
    const monday=new Date(d);monday.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    const key=monday.toISOString().slice(0,10);
    const p=groups.get(key);
    if(!p)groups.set(key,{week:key,lastDay:c.day,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume});
    else{
      if(p.lastDay===c.day)throw new Error('Duplicate candle date');
      p.lastDay=c.day;p.high=Math.max(p.high,c.high);p.low=Math.min(p.low,c.low);p.close=c.close;p.volume+=c.volume;
    }
  }
  return [...groups.values()];
}
/**
 * asOf is the scan's last completed trading date (YYYY-MM-DD).
 * Last partial ISO week is deliberately excluded; scanner only uses previous completed weeks.
 */
export function scanWeinstein(daily,{asOf=new Date().toISOString().slice(0,10),benchmarkDaily=null}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw new Error('Invalid asOf');
 const asDay=new Date(asOf+'T12:00:00Z');if(!Number.isFinite(+asDay))throw new Error('Invalid asOf');
 const monday=new Date(asDay);monday.setUTCDate(asDay.getUTCDate()-(asDay.getUTCDay()+6)%7);
 const currentWeek=monday.toISOString().slice(0,10);
 let weeks=aggregateWeeks(daily).filter(w=>w.week<currentWeek&&w.lastDay<=asOf);
 if(weeks.length<40)return {signal:'INSUFFICIENT_HISTORY',weeks:weeks.length,eligible:false};
 const c=weeks.map(w=>w.close), v=weeks.map(w=>w.volume);
 const n=c.length;
 const ma30=avg(c.slice(-30)),prevMa30=avg(c.slice(-35,-5));
 const rising=ma30>prevMa30*1.001;
 const priorHigh=Math.max(...weeks.slice(-27,-1).map(w=>w.high));
 const latest=weeks[n-1];
 const avgVolume=avg(v.slice(-11,-1));
 const volumeRatio=avgVolume>0?latest.volume/avgVolume:0;
 let relativeStrength=null;
 if(benchmarkDaily){
   const bench=aggregateWeeks(benchmarkDaily).filter(w=>w.week<currentWeek&&w.lastDay<=asOf);
   const bm=new Map(bench.map(w=>[w.week,w.close]));
   const aligned=weeks.filter(w=>bm.has(w.week));
   if(aligned.length<30)return {signal:'INSUFFICIENT_BENCHMARK',weeks:n,eligible:false};
   const current=aligned.at(-1),old=aligned.at(-27);
   if(!old)return {signal:'INSUFFICIENT_BENCHMARK',weeks:n,eligible:false};
   const ratioNow=current.close/bm.get(current.week),ratioPast=old.close/bm.get(old.week);
   relativeStrength=(ratioNow/ratioPast-1)*100;
 }
 const breakout=latest.close>priorHigh;
 const aboveMa=latest.close>ma30;
 const relOK=relativeStrength!==null&&relativeStrength>0;
 const volumeOK=volumeRatio>=1.5;
 const eligible=breakout&&aboveMa&&rising&&volumeOK&&relOK;
 return {signal:eligible?'PHASE2_BREAKOUT':'WATCH',eligible,asOf:latest.lastDay,weeks:n,
   ma30,prevMa30,priorHigh,breakout,aboveMa,rising,volumeRatio,
   relativeStrength,requiresBenchmark:true,
   /** Reference only, not a verified protective stop. */
   supportCandidate:Math.min(...weeks.slice(-8).map(w=>w.low))};
}
