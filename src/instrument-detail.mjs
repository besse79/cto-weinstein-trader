import {aggregateWeeks,scanWeinstein} from './weinstein.mjs';
import {explainSetup} from './weinstein-explain.mjs';
import {assessWatch} from './weinstein-watch.mjs';
import {analyzeHistoricalPhases} from './weinstein-history.mjs';

/** Compute completed-week chart and decision metrics from stored OHLCV only. */
export function buildInstrumentDetail(daily,benchmarkDaily,{asOf=new Date().toISOString().slice(0,10)}={}){
 const w=aggregateWeeks(daily);
 const d=new Date(asOf+'T12:00:00Z');
 if(!Number.isFinite(+d))throw new Error('Invalid asOf');
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
 const thisWeek=d.toISOString().slice(0,10);
 const completed=w.filter(x=>x.week<thisWeek&&x.lastDay<=asOf);
 const historical=analyzeHistoricalPhases(daily,benchmarkDaily,{asOf});
 const week=completed.map((x,i)=>{
  const ma30=i>=29?completed.slice(i-29,i+1).reduce((a,v)=>a+v.close,0)/30:null;
  const volumeAvg10=i>=10?completed.slice(i-10,i).reduce((a,v)=>a+v.volume,0)/10:null;
  return {week:x.week,lastDay:x.lastDay,open:x.open,high:x.high,low:x.low,
   close:x.close,volume:x.volume,ma30,volumeAvg10};
 });
 if(!week.length)return {weeks:[],indicators:null,levels:null,highlight:null,latestDay:null,
  watch:null,historical,assessment:{signal:'INSUFFICIENT_HISTORY',eligible:false,reasons:['Aucune semaine clôturée disponible']}};
 const raw=scanWeinstein(daily,{asOf,benchmarkDaily});
 const last=week.at(-1);
 const assessment=explainSetup({...raw,lastClose:raw.lastCompletedClose});
 const watch=assessWatch(daily,raw,{asOf});
 const enough=week.length>=40&&Number.isFinite(raw.priorHigh);
 const levels=enough?{
  resistance26:raw.priorHigh,
  support8:raw.supportCandidate,
  ma30:raw.ma30,
  baseHigh:Math.max(...completed.slice(-16).map(x=>x.high)),
  baseLow:Math.min(...completed.slice(-16).map(x=>x.low))
 }:null;
 const isBase=['PHASE1_LATE','PHASE1_BASE'].includes(assessment.signal);
 const isBreakout=['PHASE2_BREAKOUT','PHASE2_EXTENDED'].includes(assessment.signal);
 // Only the current base (if classified) is highlighted. Historical phase
 // transitions are NOT inferred from a one-date scanner and never invented.
 const highlight=isBase&&week.length>=16?{
  type:'CURRENT_BASE',from:week.at(-16).week,to:last.week
 }:isBreakout?{
  type:'LATEST_BREAKOUT',from:last.week,to:last.week
 }:null;
 return {weeks:week.slice(-156),indicators:raw,levels,highlight,watch,historical,
  latestDay:last.lastDay,assessment,
  explanation:'La frise V3 reconstitue des régimes heuristiques sur les clôtures hebdomadaires passées ; elle n’est ni une vérité de marché ni une prévision.'};
}
