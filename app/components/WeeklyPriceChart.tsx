'use client';
import {useMemo,useState} from 'react';

type Candle={week:string;lastDay:string;open:number;high:number;low:number;close:number;volume:number;ma30:number|null;volumeAvg10:number|null};
type Levels={resistance26:number;support8:number;ma30:number;baseHigh:number;baseLow:number}|null;
type Highlight={type:string;from:string;to:string}|null;
type DailyMarker={day:string;close:number}|null;
type PhaseWeek={week:string;phase:string;reason:string;confirmedBreakout:boolean};
const PHASE_COLORS:Record<string,string>={PHASE1:'#4e98dc',PHASE2:'#35b98b',PHASE3:'#f4ba5a',PHASE4:'#e27988'};
const num=(x:number)=>x.toLocaleString('fr-FR',{maximumFractionDigits:0});
const WIDTH=1020,PRICE_H=385,VOL_H=150,LEFT=70,RIGHT=30;

export default function WeeklyPriceChart({series,levels,highlight,dailyMarker=null,watchResistance=null,phases=[],currency='EUR'}:{
 series:Candle[];levels:Levels;highlight:Highlight;dailyMarker?:DailyMarker;watchResistance?:number|null;phases?:PhaseWeek[];currency?:string
}){
 const [hover,setHover]=useState<number|null>(null);
 const [windowWeeks,setWindowWeeks]=useState(104);
 const data=useMemo(()=>series.slice(-windowWeeks),[series,windowWeeks]);
 const chart=useMemo(()=>{
  if(!data.length)return null;
  const lines=[...data.flatMap(d=>[d.low,d.high]),...data.flatMap(d=>d.ma30==null?[]:[d.ma30])];
  if(levels)lines.push(levels.resistance26,levels.support8);
  if(Number.isFinite(dailyMarker?.close))lines.push(dailyMarker!.close);
  if(Number.isFinite(watchResistance))lines.push(watchResistance as number);
  let min=Math.min(...lines),max=Math.max(...lines);
  const pad=(max-min)*.09||1;min=Math.max(0,min-pad);max+=pad;
  const x=(i:number)=>LEFT+(i/(Math.max(1,data.length-1)))*(WIDTH-LEFT-RIGHT);
  const y=(v:number)=>18+(max-v)/(max-min)*(PRICE_H-46);
  const maxVolume=Math.max(1,...data.map(d=>d.volume));
  const volumeY=(v:number)=>VOL_H-30-(v/maxVolume)*(VOL_H-52);
  const polygon=data.map((d,i)=>[x(i),y(d.close)]);
  const pricePath=polygon.map(([xx,yy],i)=>(i?'L':'M')+xx.toFixed(2)+' '+yy.toFixed(2)).join(' ');
  const maPath=data.map((d,i)=>d.ma30==null?null:{x:x(i),y:y(d.ma30)})
   .filter((p):p is {x:number;y:number}=>p!==null)
   .map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ');
  const stageLookup=new Map(phases.map(s=>[s.week,s.phase]));
  const phaseBars=data.map((d,i)=>({phase:stageLookup.get(d.week)||'UNCLASSIFIED',i}));
  const breakoutPoints=phases.filter(s=>s.confirmedBreakout).map(s=>data.findIndex(d=>d.week===s.week)).filter(i=>i>=0);
  const idx=highlight?.type==='CURRENT_BASE'?data.findIndex(d=>d.week>=highlight.from):-1;
  const breakout=highlight?.type==='LATEST_BREAKOUT'?data.findIndex(d=>d.week===highlight.from):-1;
  return {min,max,x,y,volumeY,maxVolume,pricePath,maPath,idx,breakout,phaseBars,breakoutPoints};
 },[data,levels,highlight,dailyMarker,watchResistance,phases]);
 if(!chart||!data.length)return <p className="muted">Aucune cotation hebdomadaire disponible. Importer l'historique Yahoo pour ce titre.</p>;
 const active=hover===null?data.length-1:Math.max(0,Math.min(hover,data.length-1));
 const latest=data[active];
 const showDaily=!!dailyMarker&&dailyMarker.day>data.at(-1)!.lastDay;
 const label=currency==='EUR'?'€':currency;
 const fmtPrice=(n:number)=>n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+label;
 return <div className="weekly-chart">
  <div className="chart-toolbar">
   <strong>Prix hebdomadaire · {data.length} semaines clôturées</strong>
   <div>{[52,104,156].map(n=><button key={n} className={windowWeeks===n?'active':''} onClick={()=>{setWindowWeeks(n);setHover(null)}}>{n} sem.</button>)}</div>
  </div>
  <div className="chart-legend"><span className="legend-price">Cours</span><span className="legend-ma">MM30</span><span className="legend-resistance">Résistance 26 sem.</span><span className="legend-support">Support 8 sem.</span></div>
  <div className="chart-scroll">
   <svg viewBox={'0 0 '+WIDTH+' '+PRICE_H} role="img" aria-label="Courbe hebdomadaire avec moyenne mobile à 30 semaines, résistance, support et repère de base ou cassure" className="chart-svg"
    onMouseLeave={()=>setHover(null)}
    onMouseMove={e=>{
     const b=e.currentTarget.getBoundingClientRect();
     const screenX=(e.clientX-b.left)/b.width*WIDTH;
     setHover(Math.max(0,Math.min(data.length-1,Math.round((screenX-LEFT)/(WIDTH-LEFT-RIGHT)*(data.length-1)))));
    }}>
    {chart.phaseBars.map(({phase,i})=>{
     const color=PHASE_COLORS[phase];
     if(!color)return null;
     const space=(WIDTH-LEFT-RIGHT)/Math.max(1,data.length-1);
     const xx=Math.max(LEFT,chart.x(i)-space/2);
     return <rect key={'phase-'+i} x={xx} y={9} width={Math.min(space,WIDTH-RIGHT-xx)} height={PRICE_H-37} fill={color} opacity=".13"/>;
    })}
    {Array.from({length:5},(_,i)=>{
     const value=chart.max-(chart.max-chart.min)*i/4;
     return <g key={i}><line x1={LEFT} y1={chart.y(value)} x2={WIDTH-RIGHT} y2={chart.y(value)} stroke="#304357" strokeDasharray="3 6"/><text x={LEFT-8} y={chart.y(value)+4} textAnchor="end" fontSize="12" fill="#a6bacb">{value.toFixed(1)}</text></g>;
    })}
    {chart.idx>=0&&levels&&<rect x={chart.x(chart.idx)} y={chart.y(levels.baseHigh)} width={Math.max(2,chart.x(data.length-1)-chart.x(chart.idx))} height={Math.max(1,chart.y(levels.baseLow)-chart.y(levels.baseHigh))} fill="#2b80d0" opacity=".16"/>}
    {levels&&<>
     <line x1={LEFT} x2={WIDTH-RIGHT} y1={chart.y(levels.resistance26)} y2={chart.y(levels.resistance26)} stroke="#f19461" strokeWidth="1.7" strokeDasharray="8 6"/>
     <line x1={LEFT} x2={WIDTH-RIGHT} y1={chart.y(levels.support8)} y2={chart.y(levels.support8)} stroke="#45ba95" strokeWidth="1.7" strokeDasharray="8 6"/>
     <text x={WIDTH-RIGHT-4} y={chart.y(levels.resistance26)-7} textAnchor="end" fill="#f2b187" fontSize="12">R {levels.resistance26.toFixed(2)}</text>
     <text x={WIDTH-RIGHT-4} y={chart.y(levels.support8)+16} textAnchor="end" fill="#64d3b1" fontSize="12">S {levels.support8.toFixed(2)}</text>
    </>}
    {showDaily&&dailyMarker&&<>
     {Number.isFinite(watchResistance)&&<line x1={WIDTH-235} x2={WIDTH-RIGHT} y1={chart.y(watchResistance as number)} y2={chart.y(watchResistance as number)} stroke="#bf9fff" strokeWidth="1.6" strokeDasharray="4 4"/>}
     <line x1={WIDTH-155} x2={WIDTH-RIGHT} y1={chart.y(dailyMarker.close)} y2={chart.y(dailyMarker.close)} stroke="#f3db70" strokeWidth="2" strokeDasharray="5 4"/>
     <circle cx={WIDTH-RIGHT-5} cy={chart.y(dailyMarker.close)} r="5" fill="#f3db70"/>
     <text x={WIDTH-RIGHT-10} y={chart.y(dailyMarker.close)-11} textAnchor="end" fill="#f3db70" fontSize="12">Jour {dailyMarker.close.toFixed(2)}</text>
    </>}
    <path d={chart.pricePath} fill="none" stroke="#9cbbf4" strokeWidth="2.4" strokeLinejoin="round"/>
    {chart.maPath&&<path d={chart.maPath} fill="none" stroke="#ffc467" strokeWidth="2.4" strokeLinejoin="round"/>}
    {chart.breakoutPoints.map(i=><g key={'historical-break-'+i}>
     <circle cx={chart.x(i)} cy={chart.y(data[i].close)} r="5" fill="#53d9ae" stroke="#e7fff6" strokeWidth="1.5"/>
    </g>)}
    {chart.breakout>=0&&<g><circle cx={chart.x(chart.breakout)} cy={chart.y(data[chart.breakout].close)} r="7" fill="#53c9a4" stroke="#e7fff6" strokeWidth="2"/><text x={Math.max(LEFT+75,chart.x(chart.breakout)-6)} y={chart.y(data[chart.breakout].close)-18} textAnchor="end" fontSize="13" fill="#7ce3c2">Cassure</text></g>}
    <line x1={chart.x(active)} x2={chart.x(active)} y1="16" y2={PRICE_H-18} stroke="#adc2de" strokeOpacity=".6" strokeDasharray="3 4"/>
    <circle cx={chart.x(active)} cy={chart.y(latest.close)} r="4" fill="#fff"/>
    {data.filter((_,i)=>i%Math.max(1,Math.floor(data.length/9))===0).map(d=><text key={d.week} x={chart.x(data.indexOf(d))} y={PRICE_H-7} textAnchor="middle" fill="#96aabe" fontSize="12">{d.week.slice(0,7)}</text>)}
   </svg>
  </div>
  {showDaily&&dailyMarker&&<p className="muted">Dernière clôture quotidienne : {dailyMarker.day} — {fmtPrice(dailyMarker.close)}. Point jaune séparé, non intégré à la courbe hebdomadaire ; cassure éventuellement provisoire.</p>}
  <div className="chart-inspector"><strong>{latest.lastDay}</strong><span>Clôture : {fmtPrice(latest.close)}</span><span>MM30 : {latest.ma30==null?'—':fmtPrice(latest.ma30)}</span><span>Plus haut : {fmtPrice(latest.high)}</span><span>Plus bas : {fmtPrice(latest.low)}</span></div>
  <div className="chart-volume-heading"><strong>Volume hebdomadaire</strong><span>Colonnes : titres négociés · ligne : moyenne précédente 10 sem.</span></div>
  <div className="chart-scroll">
   <svg viewBox={'0 0 '+WIDTH+' '+VOL_H} role="img" aria-label="Volumes hebdomadaires et moyenne des dix semaines précédentes" className="chart-svg">
    {data.map((d,i)=>{const bw=Math.max(2,(WIDTH-LEFT-RIGHT)/data.length*.72);
     return <rect key={d.week} x={chart.x(i)-bw/2} y={chart.volumeY(d.volume)} width={bw} height={VOL_H-30-chart.volumeY(d.volume)} fill={d.close>=d.open?'#43ad90':'#a56971'} opacity={i===active?1:.75}/>;
    })}
    <path d={data.map((d,i)=>({d,i})).filter(p=>p.d.volumeAvg10!==null).map((p,i)=>(i?'L':'M')+chart.x(p.i).toFixed(2)+' '+chart.volumeY(p.d.volumeAvg10 as number).toFixed(2)).join(' ')} fill="none" stroke="#f1bd72" strokeWidth="2"/>
    <line x1={chart.x(active)} x2={chart.x(active)} y1="8" y2={VOL_H-30} stroke="#adc2de" strokeOpacity=".5" strokeDasharray="3 4"/>
    <text x={LEFT-9} y="18" textAnchor="end" fill="#a6bacb" fontSize="12">{num(chart.maxVolume)}</text>
    <text x={LEFT-9} y={VOL_H-26} textAnchor="end" fill="#a6bacb" fontSize="12">0</text>
   </svg>
  </div>
  <div className="chart-inspector"><span>Semaine {latest.week}</span><span>Volume : {num(latest.volume)}</span><span>Moyenne 10 sem. : {latest.volumeAvg10==null?'—':num(latest.volumeAvg10)}</span></div>
  <p className="muted">Les fonds de couleur et points de cassure sont des classifications historiques **heuristiques**, calculées sans données postérieures à chaque semaine. Les périodes ambiguës restent sans fond. Le graphique contient exclusivement les semaines clôturées. Les annotations correspondent à la configuration actuelle : les anciennes phases ne sont pas reconstituées artificiellement. Devise des prix : {label}.</p>
 </div>;
}
