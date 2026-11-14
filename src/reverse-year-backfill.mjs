/**
 * V4.1 chronological coverage planner. The caller supplies observed coverage
 * per symbol and calendar year; this module NEVER assumes bars are present.
 * Prioritizes all symbols in 2026 before starting 2025, etc.
 */
export const HISTORY_YEARS=Object.freeze([2026,2025,2024,2023,2022,2021]);
export function planReverseYearBackfill(instruments,{asOf='2026-11-13',years=HISTORY_YEARS,
  batchSize=25,limit=Infinity}={}){
 if(!Array.isArray(instruments)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||
   !Number.isFinite(Date.parse(asOf+'T12:00:00Z'))||
   !Number.isInteger(batchSize)||batchSize<1||batchSize>50||
   !(limit===Infinity||(Number.isInteger(limit)&&limit>0))||
   !Array.isArray(years)||years.some(y=>!Number.isInteger(y)||y<1990||y>Number(asOf.slice(0,4))))
  throw Error('Invalid history plan');
 const seen=new Set(),sorted=[...instruments].sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol)));
 for(const x of sorted){
  if(!x||typeof x.symbol!=='string'||!/^[A-Z0-9.^-]{1,24}$/.test(x.symbol)||
    seen.has(x.symbol))throw Error('Invalid or duplicate symbol');
  seen.add(x.symbol);
 }
 const tasks=[];
 for(const year of years){
  const start=year+'-01-01';
  const end=year===Number(asOf.slice(0,4))?asOf:year+'-12-31';
  for(const x of sorted){
   // coverage is an explicitly verified per-year completion flag, never inferred
   // from the number of bars in the entire historical series.
   if(x.verifiedYears?.[year]===true)continue;
   tasks.push({symbol:x.symbol,year,start,end});
  }
 }
 const selected=tasks.slice(0,limit);
 const batches=[];
 for(let i=0;i<selected.length;i+=batchSize){
  const group=selected.slice(i,i+batchSize);
  // No batch crosses a year boundary; a failed batch is resumable by year.
  if(batches.length&&batches.at(-1).year===group[0].year&&
    batches.at(-1).symbols.length+group.length<=batchSize){
   batches.at(-1).symbols.push(...group.map(x=>x.symbol));
  }else{
   for(let j=0;j<group.length;){
    const year=group[j].year;
    const segment=group.slice(j).filter(x=>x.year===year).slice(0,batchSize);
    batches.push({year,start:segment[0].start,end:segment[0].end,symbols:segment.map(x=>x.symbol)});
    j+=segment.length;
   }
  }
 }
 return {asOf,totalPending:tasks.length,selected:selected.length,remaining:tasks.length-selected.length,batches};
}
