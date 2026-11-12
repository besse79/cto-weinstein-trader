'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import WeeklyPriceChart from '../../components/WeeklyPriceChart';

type Candle={week:string;lastDay:string;open:number;high:number;low:number;close:number;volume:number;ma30:number|null;volumeAvg10:number|null};
type Detail={
 instrument:{id:number;symbol:string;name:string;currency:string};
 benchmark:string|null;asOf:string;latest:{day:string;close:number}|null;marketStatus:string;
 series:Candle[];levels:{resistance26:number;support8:number;ma30:number;baseHigh:number;baseLow:number}|null;
 highlight:{type:string;from:string;to:string}|null;
 assessment:{signal:string;stage?:string;eligible:boolean;reasons:string[];setupScore?:number;distanceFromMaPct?:number|null};
 metrics:{ma30?:number;volumeRatio?:number;relativeStrength?:number;maSlope6Pct?:number;resistanceDistancePct?:number;weeks?:number}|null;
 explanation:string;note:string
};
const fmt=(n:number|null|undefined,digits=2)=>n==null?'—':n.toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const names:Record<string,string>={
 PHASE1_LATE:'Fin de phase 1 — surveillance',
 PHASE1_BASE:'Base en formation — surveillance',
 PHASE2_BREAKOUT:'Entrée en phase 2 confirmée',
 PHASE2_EXTENDED:'Phase 2 déjà étendue',
 WATCH:'Configuration indéterminée',
 NO_DATA:'Aucune donnée',
 STALE_DATA:'Données de marché périmées',
 NO_BENCHMARK:'Benchmark absent',
 STALE_BENCHMARK:'Benchmark périmé',
 INSUFFICIENT_HISTORY:'Historique insuffisant',
 INSUFFICIENT_BENCHMARK:'Historique benchmark insuffisant'
};
export default function InstrumentDetailPage(){
 const params=useParams();
 const symbol=typeof params.symbol==='string'?params.symbol:'';
 const [detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  if(!symbol)return;
  let cancelled=false;
  setLoading(true);setError('');
  fetch('/api/instrument/'+encodeURIComponent(symbol),{cache:'no-store'})
   .then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||'Détail indisponible');return j})
   .then(data=>{if(!cancelled)setDetail(data)})
   .catch(e=>{if(!cancelled)setError(String(e))})
   .finally(()=>{if(!cancelled)setLoading(false)});
  return ()=>{cancelled=true};
 },[symbol]);
 const state=detail?.assessment;
 const metrics=detail?.metrics;
 const levels=detail?.levels;
 const price=(n:number|null|undefined)=>n==null?'—':fmt(n)+' '+(detail?.instrument.currency==='EUR'?'€':detail?.instrument.currency);
 return <main className="instrument-detail">
  <div className="detail-top"><Link href="/" className="detail-back">← Retour au scanner</Link><span className="badge">PAPER ONLY</span></div>
  {loading?<p>Chargement de la fiche action...</p>:error?<div className="notice" role="alert">{error}</div>:detail&&<>
   <header><div><h1>{detail.instrument.name}</h1><p className="muted">{detail.instrument.symbol} · {detail.instrument.currency} · benchmark {detail.benchmark??'absent'}</p></div>
    <div className="detail-price"><strong>{price(detail.latest?.close)}</strong><small>Dernière cotation : {detail.latest?.day??'absente'}</small></div></header>
   <div className="detail-verdict">
    <div><small>Classification Weinstein</small><h2>{names[state?.signal??'']||state?.signal}</h2>
     <p className="muted">{state?.eligible?'Signal de surveillance confirmé, aucun ordre automatique':'Non éligible à un achat fictif automatique'}</p></div>
    <div><small>Score de préparation (non probabiliste)</small><strong className="detail-score">{state?.setupScore??0}/100</strong></div>
   </div>
   <div className="detail-metrics">
    <article><small>Résistance 26 sem.</small><strong>{price(levels?.resistance26)}</strong></article>
    <article><small>Support 8 sem.</small><strong>{price(levels?.support8)}</strong></article>
    <article><small>MM30 hebdomadaire</small><strong>{price(levels?.ma30)}</strong></article>
    <article><small>Volume / moyenne</small><strong>{metrics?.volumeRatio==null?'—':fmt(metrics.volumeRatio)+'×'}</strong></article>
    <article><small>Force relative 26 sem.</small><strong>{metrics?.relativeStrength==null?'—':fmt(metrics.relativeStrength)+' %'}</strong></article>
    <article><small>Pente MM30 sur 6 sem.</small><strong>{metrics?.maSlope6Pct==null?'—':fmt(metrics.maSlope6Pct)+' %'}</strong></article>
   </div>
   <section className="chart-panel">
    <h2>Analyse graphique</h2>
    <WeeklyPriceChart series={detail.series} levels={levels} highlight={detail.highlight} currency={detail.instrument.currency}/>
   </section>
   <section className="detail-analysis">
    <h2>Pourquoi ce classement ?</h2>
    <p className="muted">Les critères sont calculés sur des semaines terminées, sans anticiper la prochaine clôture.</p>
    <ul>{state?.reasons?.length?state.reasons.map((reason,i)=><li key={i}>{reason}</li>):<li>Aucune évaluation disponible</li>}</ul>
    <div className="detail-metrics">
     <article><small>Distance à la résistance</small><strong>{metrics?.resistanceDistancePct==null?'—':fmt(metrics.resistanceDistancePct)+' %'}</strong></article>
     <article><small>Écart cours / MM30</small><strong>{state?.distanceFromMaPct==null?'—':fmt(state.distanceFromMaPct)+' %'}</strong></article>
     <article><small>Semaines analysées</small><strong>{metrics?.weeks??'—'}</strong></article>
    </div>
   </section>
   <p className="muted detail-foot">{detail.explanation} Source : historiques stockés localement, issus de Yahoo Finance non officiel. Ni prévision, ni recommandation d'investissement. Aucun ordre réel.</p>
  </>}
 </main>;
}
