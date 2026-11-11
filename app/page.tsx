'use client';
import {useEffect,useState} from 'react';
type Signal={id:number;symbol:string;name:string;currency:string;status:string;last:{day:string;close:number}|null};
type Position={id:number;symbol:string;name:string;qty:number;avg:number;last:number|null;quoteDate:string|null;stop:number|null;alert:string};
type Order={id:number;symbol:string;side:string;qty:number;price:number;fee:number;created_at:string};
type Scan={id:number;symbol:string;name:string;signal:string;eligible:boolean;last:{day:string;close:number}|null;ma30?:number;volumeRatio?:number;relativeStrength?:number;priorHigh?:number};
type Contract={conid:number;symbol:string;companyName:string;description:string;sections:{secType:string;exchange:string}[]};
type IbkrStatus={ibkr:{connected:boolean;reason?:string;authenticated?:boolean};mode:string;realOrdersEnabled:boolean};
type Dashboard={mode:string;initial:number;cash:number;equity:number;signals:Signal[];positions:Position[];orders:Order[];error?:string};
const euro=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
export default function Home(){
 const [tab,setTab]=useState(0),[data,setData]=useState<Dashboard|null>(null),[scans,setScans]=useState<Scan[]>([]),[token,setToken]=useState(''),[message,setMessage]=useState('');
 const [ibkr,setIbkr]=useState<IbkrStatus|null>(null),[contracts,setContracts]=useState<Contract[]>([]),[ibkrSymbol,setIbkrSymbol]=useState('AC.PA'),[busy,setBusy]=useState(false);
 async function load(){try{const [r,s]=await Promise.all([fetch('/api/dashboard',{cache:'no-store'}),fetch('/api/scanner',{cache:'no-store'})]);const j=await r.json();setData(j);const scanned=await s.json();setScans(Array.isArray(scanned.results)?scanned.results:[])}catch{setMessage('API indisponible')}}
 useEffect(()=>{void load()},[]);
 async function ibkrCall(action:'status'|'contracts'|'import'){
  if(!token){setMessage('Jeton APP_TOKEN local requis');return}
  setBusy(true);setMessage('');
  try {
   const url=action==='status'?'/api/ibkr':action==='contracts'?'/api/ibkr/contracts?symbol='+encodeURIComponent(ibkrSymbol):'/api/ibkr/history';
   const r=await fetch(url,{method:action==='import'?'POST':'GET',headers:{'Content-Type':'application/json','x-app-token':token},...(action==='import'?{body:JSON.stringify({symbol:ibkrSymbol})}:{})});
   const j=await r.json();
   if(!r.ok){setMessage(j.error||'IBKR indisponible');return}
   if(action==='status'){setIbkr(j);setMessage(j.ibkr?.connected?'IBKR authentifié':'Gateway non connectée ou session expirée')}
   else if(action==='contracts'){setContracts(Array.isArray(j.candidates)?j.candidates:[]);setMessage('Candidats non validés : contrôler marché, devise et type de titre avant tout mapping')}
   else {setMessage('Historique IBKR importé : '+j.count+' bougies pour '+j.symbol);await load()}
  }catch{setMessage('Erreur de connexion à l’API locale')}finally{setBusy(false)}
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
  <header><div><h1>CTO Weinstein Trader</h1><small>Stratégie Weinstein · IBKR lecture seule · Simulation interne</small></div><span className="badge">PAPER ONLY</span></header>
  <nav><button className={tab===0?'active':''} onClick={()=>setTab(0)}>01 · Trades du matin</button><button className={tab===1?'active':''} onClick={()=>setTab(1)}>02 · Portefeuille / ventes</button><button onClick={()=>void load()}>Actualiser</button></nav>
  <label>Jeton local <input aria-label="Jeton local" type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="APP_TOKEN"/></label>
  {message&&<div className="notice" role="status">{message}</div>}
  {data?.error&&<div className="notice" role="alert">PostgreSQL indisponible : {data.error}</div>}
  <div className="cards"><article><small>Capital initial fictif</small><h2>{euro(data?.initial)}</h2></article><article><small>Liquidités paper</small><h2>{euro(data?.cash)}</h2></article><article><small>Valorisation indicative</small><h2>{euro(data?.equity)}</h2></article></div>
  {tab===0?<section><h2>Trades du matin</h2><p className="muted">Le scanner Weinstein est disponible, mais aucun historique boursier réel n'est encore importé. Les achats restent désactivés jusqu'à validation des cotations et des signaux.</p><div className="table" style={{padding:16,marginBottom:16}}>
    <h3>Connexion Interactive Brokers — lecture seule</h3>
    <p className="muted">Gateway Client Portal locale requise. Aucune clé IBKR à saisir ici. Le jeton local autorise uniquement les fonctions paper de l’application.</p>
    <button disabled={busy||!token} onClick={()=>void ibkrCall('status')}>Tester la connexion IBKR</button>
    {ibkr&&<span style={{marginLeft:12}}>{ibkr.ibkr.connected?'Authentifiée':'Non connectée'}</span>}
    <div><label>Instrument surveillé <select value={ibkrSymbol} onChange={e=>{setIbkrSymbol(e.target.value);setContracts([])}} style={{margin:10,padding:8}}>
     {(data?.signals||[]).map(s=><option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>)}
    </select></label></div>
    <button disabled={busy||!token} onClick={()=>void ibkrCall('contracts')}>Rechercher le contrat IBKR</button>
    <button disabled={busy||!token||!ibkr?.ibkr.connected} style={{marginLeft:8}} onClick={()=>void ibkrCall('import')}>Importer l’historique vérifié</button>
    {contracts.length>0&&<div className="table"><table><thead><tr><th>Conid candidat</th><th>Symbole</th><th>Société</th><th>Marché</th></tr></thead><tbody>
      {contracts.map(c=><tr key={c.conid}><td>{c.conid}</td><td>{c.symbol}</td><td>{c.companyName}</td><td>{c.description}</td></tr>)}
    </tbody></table></div>}
    <small>Aucun conid n’est enregistré automatiquement. L’import exige un mapping local préalablement validé.</small>
   </div><div className="table"><table><thead><tr><th>Valeur</th><th>Marché</th><th>Dernier cours</th><th>Date</th><th>MM30</th><th>Volume ×</th><th>Force relative 26 sem.</th><th>Signal</th></tr></thead><tbody>{scans.map(s=><tr key={s.id}><td>{s.name}<small>{s.symbol}</small></td><td>{data?.signals.find(x=>x.id===s.id)?.currency??'—'}</td><td>{euro(s.last?.close)}</td><td>{s.last?.day??'—'}</td><td>{euro(s.ma30)}</td><td>{s.volumeRatio==null?'—':s.volumeRatio.toFixed(2)}</td><td>{s.relativeStrength==null?'—':s.relativeStrength.toFixed(1)+' %'}</td><td>{s.eligible?'CASSURE PHASE 2':s.signal}</td></tr>)}</tbody></table></div></section>:
  <section><h2>Portefeuille et ventes fictives</h2><div className="table"><table><thead><tr><th>Valeur</th><th>Quantité</th><th>PRU</th><th>Cours</th><th>Stop</th><th>Signal</th><th>Action</th></tr></thead><tbody>{data?.positions.length?data.positions.map(p=><tr key={p.id}><td>{p.name}<small>{p.symbol}</small></td><td>{p.qty}</td><td>{euro(p.avg)}</td><td>{euro(p.last)}</td><td>{euro(p.stop)}</td><td>{p.alert}</td><td><button disabled={!token||p.last==null} onClick={()=>void order(p,'SELL')}>Vendre paper</button></td></tr>):<tr><td colSpan={7}>Aucune position ouverte</td></tr>}</tbody></table></div>
  <h2>Historique paper</h2><div className="table"><table><thead><tr><th>Date</th><th>Instrument</th><th>Opération</th><th>Quantité</th><th>Prix</th></tr></thead><tbody>{data?.orders.map(o=><tr key={o.id}><td>{new Date(o.created_at).toLocaleString('fr-FR')}</td><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty}</td><td>{euro(Number(o.price))}</td></tr>)}</tbody></table></div></section>}
 </main>;
}
