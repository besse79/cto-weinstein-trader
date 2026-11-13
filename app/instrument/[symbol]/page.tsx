'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import WeeklyPriceChart from '../../components/WeeklyPriceChart';

type Candle={week:string;lastDay:string;open:number;high:number;low:number;close:number;volume:number;ma30:number|null;volumeAvg10:number|null};
type Historical={weeks:{week:string;phase:string;reason:string;confirmedBreakout:boolean}[];transitions:{week:string;from:string;to:string;close:number;confirmedBreakout:boolean}[];counts:Record<string,number>;signals:number;forwardOutcomes:{weeks:number;samples:number;averageReturnPct:number|null;positiveRatePct:number|null}[];note:string;methodology:string};
type Detail={
 instrument:{id:number;symbol:string;name:string;currency:string};
 benchmark:string|null;asOf:string;latest:{day:string;close:number}|null;marketStatus:string;
 series:Candle[];levels:{resistance26:number;support8:number;ma30:number;baseHigh:number;baseLow:number}|null;
 highlight:{type:string;from:string;to:string}|null;
 assessment:{signal:string;stage?:string;eligible:boolean;reasons:string[];setupScore?:number;distanceFromMaPct?:number|null};
 metrics:{ma30?:number;volumeRatio?:number;relativeStrength?:number;maSlope6Pct?:number;resistanceDistancePct?:number;weeks?:number}|null;
 watch:{watchScore:number|null;watchStatus:string;watchReasons:string[];currentResistance:number|null;distanceToResistancePct:number|null;provisional:boolean;latestDaily:{day:string;close:number}|null;lastCompletedWeek:string|null}|null;
 historical:Historical|null;
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
   {detail.watch?.watchScore!=null&&<div className="detail-verdict">
    <div><small>Veille quotidienne (distincte de la phase hebdomadaire)</small>
     <h2>{detail.watch.provisional?'CASSURE EN COURS — CONFIRMATION HEBDOMADAIRE ATTENDUE':
       detail.watch.watchStatus==='NEAR_RESISTANCE'?'PROCHE DE LA RÉSISTANCE':'SURVEILLANCE'}
     </h2>
     <p className="muted">Dernier cours quotidien : {detail.watch.latestDaily?.day} · Résistance des 26 semaines clôturées : {price(detail.watch.currentResistance)}. Aucun achat automatique.</p>
    </div>
    <div><small>Score de proximité, sans portée prédictive</small><strong className="detail-score">{detail.watch.watchScore}/100</strong></div>
   </div>}
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
    <WeeklyPriceChart series={detail.series} levels={levels??null} highlight={detail.highlight} dailyMarker={detail.watch?.latestDaily??null} watchResistance={detail.watch?.currentResistance??null} phases={detail.historical?.weeks??[]} currency={detail.instrument.currency}/>
   </section>
   {detail.historical&&<section className="detail-analysis">
    <h2>V3 · Historique des phases Weinstein</h2>
    <p className="muted">{detail.historical.note} Les phases sont estimées semaine après semaine, sans connaître le futur.</p>
    <div className="detail-metrics">
     {['PHASE1','PHASE2','PHASE3','PHASE4'].map((p,i)=><article key={p}>
       <small>Phase {i+1}</small><strong>{detail.historical?.counts[p]??0} sem.</strong>
      </article>)}
     <article><small>Transitions confirmées vers phase 2</small><strong>{detail.historical.signals}</strong></article>
     <article><small>Semaines non classées</small><strong>{detail.historical.counts.UNCLASSIFIED??0}</strong></article>
    </div>
    <h3>Dernières transitions détectées</h3>
    <div className="table"><table><thead><tr><th>Semaine</th><th>Ancien état</th><th>Nouvelle phase</th><th>Clôture</th><th>Cassure confirmée</th></tr></thead>
     <tbody>{detail.historical.transitions.length?detail.historical.transitions.slice(-10).reverse().map((x,i)=><tr key={x.week+'-'+i}>
      <td>{x.week}</td><td>{x.from.replace('PHASE','Phase ')}</td><td>{x.to.replace('PHASE','Phase ')}</td>
      <td>{price(x.close)}</td><td>{x.confirmedBreakout?'Oui':'Non'}</td></tr>):
      <tr><td colSpan={5}>Aucune transition classable avec les données disponibles.</td></tr>}</tbody></table></div>
    <h3>Observation des rendements après cassure</h3>
    <div className="table"><table><thead><tr><th>Horizon</th><th>Échantillons terminés</th><th>Rendement moyen brut</th><th>Part positive</th></tr></thead>
     <tbody>{detail.historical.forwardOutcomes.map(x=><tr key={x.weeks}>
      <td>{x.weeks} semaines</td><td>{x.samples}</td>
      <td>{x.averageReturnPct==null?'Données insuffisantes':fmt(x.averageReturnPct)+' %'}</td>
      <td>{x.positiveRatePct==null?'—':fmt(x.positiveRatePct,1)+' %'}</td></tr>)}</tbody></table></div>
    <p className="muted">Ces chiffres décrivent des cours passés ; il ne s'agit pas d'un backtest de portefeuille. Pas de frais, de change, ni de correction validée des dividendes, splits et biais de survivance.</p>
   </section>}
   <section className="detail-analysis">
    <h2>Pourquoi ce classement ?</h2>
    <p className="muted">Les critères sont calculés sur des semaines terminées, sans anticiper la prochaine clôture.</p>
    <ul>{state?.reasons?.length?state.reasons.map((reason,i)=><li key={i}>{reason}</li>):<li>Aucune évaluation disponible</li>}</ul>
    {detail.watch && detail.watch.watchReasons.length>0&&<><h3>Critères de veille quotidienne</h3>
     <ul>{detail.watch.watchReasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
    </>}
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
