/** Conservative PIT comparison of W's stored bars vs MKD's certified bars.
 * Read-only: diagnostics only, never rewrites either data source.
 */
export function compareMarketSeries(local,mkd,{
 priceTolerance=0.00001,volumeTolerance=0
}={}){
 if(!Array.isArray(local)||!Array.isArray(mkd)||
  !Number.isFinite(priceTolerance)||priceTolerance<0||
  !Number.isInteger(volumeTolerance)||volumeTolerance<0)
  throw new Error('Invalid parity series arguments');
 const issues=[];
 const rows=series=>{
  const byDay=new Map();
  for(const x of series){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(x?.day)||byDay.has(x.day))
    throw new Error('Invalid or duplicate daily session');
   byDay.set(x.day,x);
  }
  return byDay;
 };
 const w=rows(local),m=rows(mkd);
 let verified=0;
 for(const day of new Set([...w.keys(),...m.keys()])){
  const a=w.get(day),b=m.get(day);
  if(!a||!b){issues.push({day,type:!a?'MISSING_W':'MISSING_MKD'});continue}
  for(const field of ['open','high','low','close']){
   const x=Number(a[field]),y=Number(b[field]);
   if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x-y)>priceTolerance)
    issues.push({day,type:'PRICE_MISMATCH',field,w:a[field],mkd:b[field]});
  }
  if(!Number.isSafeInteger(Number(a.volume))||
     !Number.isSafeInteger(Number(b.volume))||
     Math.abs(Number(a.volume)-Number(b.volume))>volumeTolerance)
   issues.push({day,type:'VOLUME_MISMATCH',w:a.volume,mkd:b.volume});
  if(a.currency&&b.currency&&a.currency!==b.currency)
   issues.push({day,type:'CURRENCY_MISMATCH',w:a.currency,mkd:b.currency});
  verified++;
 }
 return {status:issues.length?'NO_PARITY':'PARITY_CONFIRMED',
  comparedDays:verified,wDays:w.size,mkdDays:m.size,differences:issues,
  mutations:0};
}
export function compareWeinsteinSignals(w,mkd){
 if(!Array.isArray(w)||!Array.isArray(mkd))throw new Error('Signals required');
 const keys=['symbol','currency','signal','stage','eligible','asOf','benchmark'];
 const bySymbol=xs=>new Map(xs.map(x=>[x.symbol,x]));
 const a=bySymbol(w),b=bySymbol(mkd);
 const differences=[];
 for(const symbol of new Set([...a.keys(),...b.keys()])){
  const left=a.get(symbol),right=b.get(symbol);
  if(!left||!right){differences.push({symbol,type:'MISSING_SIGNAL'});continue}
  for(const key of keys)if(left[key]!==right[key])
   differences.push({symbol,type:'SIGNAL_DIFFERENCE',field:key,
     local:left[key],mkd:right[key]});
 }
 return {status:differences.length?'NO_PARITY':'PARITY_CONFIRMED',differences,
  comparedSymbols:a.size,mutations:0};
}
