import {aggregateWeeks} from './weinstein.mjs';

const mean=xs=>xs.reduce((sum,x)=>sum+x,0)/xs.length;

/**
 * Retrospective descriptive Weinstein regime labeling, computed left-to-right
 * on COMPLETED ISO weeks only. Every assessment uses observations <= its week.
 * Ambiguous cases deliberately remain UNCLASSIFIED; this is not a historical
 * record of market consensus stage labels or a predictive trading system.
 */
export function analyzeHistoricalPhases(daily,benchmarkDaily,{asOf=new Date().toISOString().slice(0,10)}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||Number.isNaN(Date.parse(asOf+'T12:00:00Z')))
  throw new Error('Invalid asOf');
 const today=new Date(asOf+'T12:00:00Z');
 today.setUTCDate(today.getUTCDate()-(today.getUTCDay()+6)%7);
 const cutoff=today.toISOString().slice(0,10);
 const weeks=aggregateWeeks(daily).filter(w=>w.week<cutoff&&w.lastDay<=asOf);
 const ref=aggregateWeeks(benchmarkDaily||[]).filter(w=>w.week<cutoff&&w.lastDay<=asOf);
 const bm=new Map(ref.map(w=>[w.week,w.close]));
 const labels=[];
 const transitions=[];
 let lastPersistent='UNCLASSIFIED';
 let lastPhase2Index=-Infinity;
 for(let i=0;i<weeks.length;i++){
  const week=weeks[i],historical=weeks.slice(0,i+1),prior=historical.slice(0,-1);
  if(i<40 || !bm.has(week.week) || !bm.has(weeks[i-26].week)){
   labels.push({week:week.week,phase:'UNCLASSIFIED',reason:'Historique ou indice insuffisant',confirmedBreakout:false});
   continue;
  }
  const ma=mean(historical.slice(-30).map(w=>w.close));
  const maOlder=mean(historical.slice(-36,-6).map(w=>w.close));
  const slope=(ma/maOlder-1)*100;
  const peak26=Math.max(...prior.slice(-26).map(w=>w.high));
  const volume10=mean(prior.slice(-10).map(w=>w.volume));
  const volumeRatio=volume10>0?week.volume/volume10:0;
  const price=week.close;
  const rs=(price/bm.get(week.week))/(weeks[i-26].close/bm.get(weeks[i-26].week))-1;
  const recent=historical.slice(-16);
  const baseLow=Math.min(...recent.map(w=>w.low));
  const baseHigh=Math.max(...recent.map(w=>w.high));
  const basePct=(baseHigh/baseLow-1)*100;
  const previous=weeks.slice(Math.max(0,i-68),Math.max(0,i-16));
  const earlierPeak=previous.length?Math.max(...previous.map(w=>w.high)):null;
  const priorDecline=earlierPeak?(1-baseLow/earlierPeak)*100:0;
  const priorBase=prior.slice(-12);
  const priorBasePct=priorBase.length>=12?
    (Math.max(...priorBase.map(w=>w.high))/Math.min(...priorBase.map(w=>w.low))-1)*100:Infinity;
  const confirmedBreakout=price>peak26&&price>ma&&slope>0.1&&volumeRatio>=1.5&&
    rs>0&&priorBasePct<=30;
  let phase='UNCLASSIFIED',reason='Critères de régime non concluants';
  if(confirmedBreakout){
   phase='PHASE2';reason='Cassure à la clôture hebdomadaire avec MM30, volume et force relative';
   lastPhase2Index=i;
  }else if(lastPersistent==='PHASE2'&&price>=ma*.98&&slope>=-1&&rs>-0.08){
   phase='PHASE2';reason='Tendance haussière maintenue au-dessus de la MM30';
  }else if((lastPersistent==='PHASE2'||lastPersistent==='PHASE3'||i-lastPhase2Index<=18)&&
     price>=ma*.94&&price<=ma*1.12&&Math.abs(slope)<=3&&basePct<=28){
   phase='PHASE3';reason='Consolidation et MM30 qui ralentit après une hausse détectée';
  }else if(price<ma*.97&&slope< -1){
   phase='PHASE4';reason='Cours sous une MM30 orientée à la baisse';
  }else if(basePct<=30&&priorDecline>=18&&Math.abs(slope)<=4&&price>=ma*.95&&rs>=-0.05){
   phase='PHASE1';reason='Base après repli, MM30 stabilisée et force relative acceptable';
  }
  if(phase!=='UNCLASSIFIED'){
   if(phase!==lastPersistent)transitions.push({week:week.week,from:lastPersistent,to:phase,
     close:price,confirmedBreakout});
   lastPersistent=phase;
  }
  labels.push({week:week.week,phase,reason,confirmedBreakout,
   ma30:ma,maSlope6Pct:slope,volumeRatio,relativeStrength26Pct:rs*100,
   resistance26:peak26,close:price});
 }
 const counts={PHASE1:0,PHASE2:0,PHASE3:0,PHASE4:0,UNCLASSIFIED:0};
 for(const row of labels)counts[row.phase]++;
 const breaks=transitions.filter(t=>t.to==='PHASE2'&&t.confirmedBreakout);
 const horizons=[4,8,12];
 const outcomes=horizons.map(h=>{
  const sample=breaks.map(t=>{
   const index=weeks.findIndex(w=>w.week===t.week);
   return index+h<weeks.length?(weeks[index+h].close/t.close-1)*100:null;
  }).filter(v=>v!==null);
  return {weeks:h,samples:sample.length,averageReturnPct:sample.length?
    mean(sample):null,positiveRatePct:sample.length?
    sample.filter(v=>v>0).length/sample.length*100:null};
 });
 return {weeks:labels.slice(-156),transitions:transitions.slice(-100),
  counts,signals:breaks.length,forwardOutcomes:outcomes,
  methodology:'Descriptive, hindsight evaluation of rule signals; no spread/fees, FX, survivorship, splits/dividend corrections or live execution. Not a trade backtest.',
  note:'Chaque phase est estimée à la clôture d’une semaine avec les seules données alors disponibles. Les périodes ambigües restent non classées.'};
}
