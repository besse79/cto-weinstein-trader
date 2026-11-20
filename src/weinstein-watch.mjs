import {aggregateWeeks} from './weinstein.mjs';

const round1=x=>Math.round(x*10)/10;
const checkDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00:00Z'));

/**
 * Research-only opportunity score. Never changes the validated weekly signal.
 * Current week's *completed daily* close is evaluated independently against
 * the 26 previous, fully completed weekly highs.
 */
export function assessWatch(daily,scan,{asOf=new Date().toISOString().slice(0,10)}={}){
 const empty={watchScore:null,watchStatus:'UNAVAILABLE',watchReasons:[],
   currentResistance:null,distanceToResistancePct:null,
   provisional:false,latestDaily:null,lastCompletedWeek:null};
 if(!checkDay(asOf))throw new Error('Invalid asOf');
 if(!Array.isArray(daily)||daily.length===0||!Number.isFinite(scan?.ma30)||
    !Number.isFinite(scan?.relativeStrength)||scan.weeks<40)return empty;
 const bars=daily.filter(d=>checkDay(d.day)&&d.day<=asOf)
  .sort((a,b)=>a.day.localeCompare(b.day));
 if(!bars.length)return empty;
 const last=bars.at(-1);
 const d=new Date(asOf+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
 const currentWeek=d.toISOString().slice(0,10);
 const weeks=aggregateWeeks(bars).filter(w=>w.week<currentWeek);
 if(weeks.length<40)return empty;
 const prior=weeks.slice(-26);
 const resistance=Math.max(...prior.map(w=>w.high));
 const distance=(resistance/last.close-1)*100;
 const latestCompleted=weeks.at(-1);
 const inCurrentWeek=last.day>=currentWeek;
 const provisional=inCurrentWeek&&last.close>resistance;
 const near=distance>=0&&distance<=10;
 const priceAboveMa=last.close>scan.ma30;
 const slope=scan.maSlope6Pct;
 const rs=scan.relativeStrength;
 const vol=scan.volumeRatio;
 const base=scan.hasBaseForBreakout===true;
 const nearPts=distance<=0?30:distance<=5?26:distance<=10?19:distance<=20?9:0;
 const score=nearPts+(priceAboveMa?20:0)+(slope>0?15:0)+
   (rs>5?15:rs>0?11:rs>=-5?4:0)+
   (vol>=1.5?10:vol>=1.2?5:0)+(base?10:0);
 const reasons=[];
 if(provisional)reasons.push('Cours quotidien au-dessus de la résistance : clôture hebdomadaire non confirmée');
 else if(distance<=0)reasons.push('Cours au-dessus de la résistance historique, sans cassure hebdomadaire confirmée pour cette séance');
 else if(near)reasons.push('Cours à '+round1(distance)+' % de la résistance');
 else reasons.push('Cours éloigné de '+round1(distance)+' % de la résistance');
 reasons.push(priceAboveMa?'Cours au-dessus de la MM30':'Cours sous la MM30');
 reasons.push(slope>0?'MM30 orientée à la hausse':'MM30 non haussière');
 reasons.push(rs>0?'Force relative positive':'Force relative faible ou négative');
 reasons.push(vol>=1.5?'Volume hebdomadaire confirmé ≥ 1,5×': 'Volume hebdomadaire confirmé inférieur à 1,5×');
 if(!base)reasons.push('Base préalable de 12 semaines non confirmée');
 return {watchScore:Math.min(score,100),
   watchStatus:provisional?'PROVISIONAL_BREAKOUT':near?'NEAR_RESISTANCE':'WATCH',
   watchReasons:reasons,currentResistance:resistance,
   distanceToResistancePct:distance,provisional,
   latestDaily:{day:last.day,close:last.close},lastCompletedWeek:latestCompleted.lastDay};
}
