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
 const keys=['symbol','currency','signal','stage','eligible','asOf','benchmark',
  'stageRank','setupScore','lastCompletedClose','ma30','prevMa30','priorHigh',
  'relativeStrength','volumeRatio','supportCandidate','hasBaseForBreakout',
  'breakout','rising','aboveMa'];
 const bySymbol=xs=>{
  const result=new Map();
  for(const row of xs){
   if(!row||typeof row.symbol!=='string'||!row.symbol.trim()||
      row.symbol!==row.symbol.trim()||result.has(row.symbol))
    throw new Error('Invalid or duplicate Weinstein signal symbol');
   result.set(row.symbol,row);
  }
  return result;
 };
 const a=bySymbol(w),b=bySymbol(mkd);
 const differences=[];
 for(const symbol of new Set([...a.keys(),...b.keys()])){
  const left=a.get(symbol),right=b.get(symbol);
  if(!left||!right){differences.push({symbol,type:'MISSING_SIGNAL'});continue}
  for(const key of keys){
   const l=left[key],r=right[key];
   const equal=typeof l==='number'&&typeof r==='number'
    ?Number.isFinite(l)&&Number.isFinite(r)&&Math.abs(l-r)<=0.00001:l===r;
   if(!equal)differences.push({symbol,type:'SIGNAL_DIFFERENCE',field:key,
     local:l,mkd:r});
  }
 }
 return {status:differences.length?'NO_PARITY':'PARITY_CONFIRMED',differences,
  comparedSymbols:a.size,mutations:0};
}

/**
 * Compare the same deterministic historical portfolio computation using
 * local vs MKD OHLCV snapshots. Analysis only: no replayed order is executed.
 */
export function compareBacktestOutputs(local,mkd,{tolerance=0.00001}={}){
 if(!local||!mkd||!Number.isFinite(tolerance)||tolerance<0||
  local.mode!=='PAPER_PORTFOLIO_BACKTEST'||
  mkd.mode!=='PAPER_PORTFOLIO_BACKTEST'||
  !Array.isArray(local.equityCurve)||!Array.isArray(mkd.equityCurve)||
  !Array.isArray(local.trades)||!Array.isArray(mkd.trades))
  throw new Error('Two PAPER backtest results are required');
 const differences=[];
 const metrics=['initialCash','finalCash','finalEquity','returnPct',
  'maxDrawdownPct','tradeCount','closedPnl','symbolsAnalyzed'];
 for(const key of metrics){
  const a=local[key],b=mkd[key];
  const equal=typeof a==='number'&&typeof b==='number'
   ?Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance:a===b;
  if(!equal)differences.push({type:'PERFORMANCE_MISMATCH',field:key,local:a,mkd:b});
 }
 if(local.equityCurve.length!==mkd.equityCurve.length)
  differences.push({type:'EQUITY_CURVE_LENGTH'});
 else for(let i=0;i<local.equityCurve.length;i++){
  const a=local.equityCurve[i],b=mkd.equityCurve[i];
  if(a.week!==b.week||a.openPositions!==b.openPositions||
   !Number.isFinite(a.cash)||!Number.isFinite(b.cash)||
   !Number.isFinite(a.equity)||!Number.isFinite(b.equity)||
   Math.abs(a.cash-b.cash)>tolerance||Math.abs(a.equity-b.equity)>tolerance)
    differences.push({type:'EQUITY_CURVE_MISMATCH',week:a.week});
 }
 if(local.trades.length!==mkd.trades.length)
  differences.push({type:'TRADE_COUNT_MISMATCH'});
 else for(let i=0;i<local.trades.length;i++){
  const a=local.trades[i],b=mkd.trades[i];
  for(const field of ['symbol','signalWeek','entryWeek','exitWeek','quantity',
   'exitReason','entryPrice','exitPrice','stop','pnl']){
   const x=a[field],y=b[field];
   const equal=typeof x==='number'&&typeof y==='number'
    ?Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=tolerance:x===y;
   if(!equal)differences.push({type:'TRADE_MISMATCH',trade:i,field});
  }
 }
 return {status:differences.length?'NO_PARITY':'PARITY_CONFIRMED',
  localWeeks:local.equityCurve.length,mkdWeeks:mkd.equityCurve.length,
  differences,mutations:0};
}
