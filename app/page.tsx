'use client';
import {useEffect,useState} from 'react';
type Signal={id:number;symbol:string;name:string;currency:string;status:string;last:{day:string;close:number}|null};
type Position={id:number;symbol:string;name:string;qty:number;avg:number;last:number|null;quoteDate:string|null;stop:number|null;alert:string};
type Order={id:number;symbol:string;side:string;qty:number;price:number;fee:number;created_at:string};
type Scan={id:number;symbol:string;name:string;signal:string;stage?:string;stageRank?:number;setupScore?:number;resistanceDistancePct?:number;maSlope6Pct?:number;priorDeclinePct?:number;eligible:boolean;last:{day:string;close:number}|null;ma30?:number;volumeRatio?:number;relativeStrength?:number;priorHigh?:number};
type Dashboard={mode:string;initial:number;cash:number;equity:number;signals:Signal[];positions:Position[];orders:Order[];error?:string};
const euro=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
export default function Home(){
 const [tab,setTab]=useState(0),[data,setData]=useState<Dashboard|null>(null),[scans,setScans]=useState<Scan[]>([]),[token,setToken]=useState(''),[message,setMessage]=useState('');
 const [syncBusy,setSyncBusy]=useState(false);
 async function load(){try{const [r,s]=await Promise.all([fetch('/api/dashboard',{cache:'no-store'}),fetch('/api/scanner',{cache:'no-store'})]);const j=await r.json();setData(j);const scanned=await s.json();setScans(Array.isArray(scanned.results)?scanned.results:[])}catch{setMessage('API indisponible')}}
 useEffect(()=>{void load()},[]);
 async function syncYahoo(){
  if(!token){setMessage('Jeton local APP_TOKEN requis pour importer les cotations');return}
  setSyncBusy(true);setMessage('Import des historiques en cours...');
  try{
   const response=await fetch('/api/market/sync',{method:'POST',
    headers:{'Content-Type':'application/json','x-app-token':token},
    body:JSON.stringify({all:true})});
   const result=await response.json();
   if(!response.ok){setMessage('Import bloqué : '+(result.detail||result.error||'Yahoo indisponible'));return}
   setMessage('Import Yahoo effectué : '+result.results.length+' instruments, '+result.total+' bougies journalières. Aucune transaction générée.');
   await load();
  }catch{setMessage('Import impossible : réseau ou API indisponible')}
  finally{setSyncBusy(false)}
 }
 async function order(p:Position,side:'SELL'){
  if(!p.last)return;
  const q=Number(prompt('Quantité paper à vendre',String(p.qty)));
  if(!Number.isFinite(q)||q<=0||q>p.qty)return;
  if(!confirm('Confirmer la vente fictive de '+q+' × '+p.symbol+' ?'))return;
  const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','x-app-token':token},body:JSON.stringify({instrumentId:p.id,qty:q,price:p.last,side,fee:0})});
  const j=await r.json();setMessage(j.ok?'Vente paper enregistrée':j.error||'Erreur');await load();
 }
 return <main>
  <header><div><h1>CTO Weinstein Trader</h1><small>Stratégie Weinstein · Yahoo Finance (cours non officiels) · Simulation interne</small></div><span className="badge">PAPER ONLY</span></header>
  <nav><button className={tab===0?'active':''} onClick={()=>setTab(0)}>01 · Trades du matin</button><button className={tab===1?'active':''} onClick={()=>setTab(1)}>02 · Portefeuille / ventes</button><button onClick={()=>void load()}>Actualiser</button></nav>
  <label>Jeton local <input aria-label="Jeton local" type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="APP_TOKEN"/></label>
  {message&&<div className="notice" role="status">{message}</div>}
  {data?.error&&<div className="notice" role="alert">PostgreSQL indisponible : {data.error}</div>}
  <div className="cards"><article><small>Capital initial fictif</small><h2>{euro(data?.initial)}</h2></article><article><small>Liquidités paper</small><h2>{euro(data?.cash)}</h2></article><article><small>Valorisation indicative</small><h2>{euro(data?.equity)}</h2></article></div>
  {tab===0?<section><h2>Trades du matin</h2><p className="muted">Détection prioritaire des entrées confirmées en phase 2 et, en anticipation, des bases de fin de phase 1. Une fin de phase 1 n'est pas un signal d'achat. Aucune opération n'est déclenchée automatiquement.</p><div className="table" style={{padding:16,marginBottom:16}}>
    <h3>Historique Yahoo Finance — recherche personnelle</h3>
    <p className="muted">Import manuel de 5 ans de cotations quotidiennes pour toute la liste surveillée, benchmarks compris. Aucun compte de courtage requis. Source non officielle, susceptible d'être indisponible et soumise aux conditions de Yahoo.</p>
    <button disabled={syncBusy||!token} onClick={()=>void syncYahoo()}>
      {syncBusy?'Synchronisation en cours...':'Importer les historiques Yahoo (5 ans)'}
    </button>
    <p className="muted">Aucune collecte programmée, aucune transaction réelle. Les cours du jour non clôturés sont exclus.</p>
   </div>
   <div className="cards">
    <article><small>Entrées phase 2 confirmées</small><h2>{scans.filter(s=>s.signal==='PHASE2_BREAKOUT'&&s.eligible).length}</h2></article>
    <article><small>Fins de phase 1 à surveiller</small><h2>{scans.filter(s=>s.signal==='PHASE1_LATE').length}</h2></article>
    <article><small>Formation d'une base</small><h2>{scans.filter(s=>s.signal==='PHASE1_BASE').length}</h2></article>
   </div>
   <div className="table"><table><thead><tr><th>Valeur</th><th>Dernier cours</th><th>MM30</th><th>Distance résistance</th><th>Pente MM30 (6 sem.)</th><th>Volume ×</th><th>Force relative</th><th>Priorité</th><th>Classement</th></tr></thead><tbody>{scans.map(s=><tr key={s.id}><td>{s.name}<small>{s.symbol} · {s.last?.day??'Donnée absente'}</small></td><td>{euro(s.last?.close)}</td><td>{euro(s.ma30)}</td><td>{s.resistanceDistancePct==null?'—':s.resistanceDistancePct.toFixed(1)+' %'}</td><td>{s.maSlope6Pct==null?'—':s.maSlope6Pct.toFixed(1)+' %'}</td><td>{s.volumeRatio==null?'—':s.volumeRatio.toFixed(2)}</td><td>{s.relativeStrength==null?'—':s.relativeStrength.toFixed(1)+' %'}</td><td>{s.signal==='PHASE2_BREAKOUT'&&s.eligible?'ENTRÉE PHASE 2':s.signal==='PHASE1_LATE'?'FIN PHASE 1 · VEILLE':s.signal==='PHASE1_BASE'?'BASE EN FORMATION':s.signal==='WATCH'?'À ÉCARTER / INDETERMINÉ':s.signal}</td><td>{s.setupScore==null?'—':s.setupScore+' / 100'}</td></tr>)}</tbody></table></div>
   <p className="muted">Classement indicatif fondé sur les clôtures hebdomadaires, la MM30, une base de 16 semaines, un recul antérieur et la force relative au benchmark EUR. Les profils de phase 1 ne sont jamais éligibles à l’achat.</p>
   </section>:
  <section><h2>Portefeuille et ventes fictives</h2><div className="table"><table><thead><tr><th>Valeur</th><th>Quantité</th><th>PRU</th><th>Cours</th><th>Stop</th><th>Signal</th><th>Action</th></tr></thead><tbody>{data?.positions.length?data.positions.map(p=><tr key={p.id}><td>{p.name}<small>{p.symbol}</small></td><td>{p.qty}</td><td>{euro(p.avg)}</td><td>{euro(p.last)}</td><td>{euro(p.stop)}</td><td>{p.alert}</td><td><button disabled={!token||p.last==null} onClick={()=>void order(p,'SELL')}>Vendre paper</button></td></tr>):<tr><td colSpan={7}>Aucune position ouverte</td></tr>}</tbody></table></div>
  <h2>Historique paper</h2><div className="table"><table><thead><tr><th>Date</th><th>Instrument</th><th>Opération</th><th>Quantité</th><th>Prix</th></tr></thead><tbody>{data?.orders.map(o=><tr key={o.id}><td>{new Date(o.created_at).toLocaleString('fr-FR')}</td><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty}</td><td>{euro(Number(o.price))}</td></tr>)}</tbody></table></div></section>}
 </main>;
}
