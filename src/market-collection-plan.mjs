const maxBatch=6;
export function parisClock(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'
 }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,
  weekday:parts.weekday,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function selectMarketBatches(instruments,kind,day,{maxSymbols=144}={}){
 if(!Array.isArray(instruments)||!['BOOTSTRAP','EU_CLOSE','US_CLOSE'].includes(kind)||
  !Number.isInteger(maxSymbols)||maxSymbols<1||maxSymbols>250)
  throw Error('Invalid collection plan');
 const seen=new Set();
 const age=x=>x?Math.round((Date.parse(day+'T12:00:00Z')-Date.parse(x+'T12:00:00Z'))/86400000):Infinity;
 const rows=instruments.filter(x=>{
  if(!x||typeof x.symbol!=='string'||seen.has(x.symbol)||
   !/^[A-Z0-9.^-]{1,24}$/.test(x.symbol))return false;
  seen.add(x.symbol);
  if(!['EUR','USD'].includes(x.currency))return false;
  if(kind==='EU_CLOSE'&&x.currency!=='EUR')return false;
  if(kind==='US_CLOSE'&&x.currency!=='USD')return false;
  if(kind==='BOOTSTRAP'&&Number(x.bars)>=250&&age(x.last_day)>=0&&age(x.last_day)<4)return false;
  return true;
 });
 // Prioritize benchmarks. Rotate secondary symbols on larger future
 // universes to avoid permanently excluding the tail of a free quota.
 const primary=rows.filter(x=>x.symbol==='EXSA.DE'||x.symbol==='SPY');
 const rest=rows.filter(x=>!primary.includes(x)).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 const ordinal=Math.floor(Date.parse(day+'T12:00:00Z')/86400000);
 const offset=kind==='BOOTSTRAP'?0:rest.length?ordinal%rest.length:0;
 const rotated=rest.slice(offset).concat(rest.slice(0,offset));
 const selected=primary.concat(rotated).slice(0,maxSymbols);
 const groups=[];
 for(const mode of ['history','delta']){
  const matching=selected.filter(x=>(Number(x.bars)<250||age(x.last_day)>60||age(x.last_day)<0?'history':'delta')===mode);
  for(let i=0;i<matching.length;i+=maxBatch)
   groups.push({mode,symbols:matching.slice(i,i+maxBatch).map(x=>x.symbol)});
 }
 return {groups,selected:selected.length,remaining:Math.max(0,rows.length-selected.length)};
}
