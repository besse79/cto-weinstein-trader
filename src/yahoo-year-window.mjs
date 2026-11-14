/** Explicit Yahoo chart calendar windows for resumable reverse-year backfills.
 * Uses UTC calendar boundaries with exclusive period2; exchange-local dates
 * must still be checked by the caller before persisting any OHLCV.
 */
const ticker=/^[A-Z0-9.^-]{1,24}$/;
export function yahooYearWindowUrl(symbol,year,{asOf='2026-11-13',base='https://query1.finance.yahoo.com'}={}){
 if(!ticker.test(symbol)||!Number.isInteger(year)||year<1990||year>2100||
  !/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf+'T12:00:00Z'))||
  year>Number(asOf.slice(0,4)))throw Error('Invalid Yahoo year window');
 const start=year+'-01-01',end=year===Number(asOf.slice(0,4))?asOf:year+'-12-31';
 const period1=Math.floor(Date.parse(start+'T00:00:00Z')/1000);
 const period2=Math.floor((Date.parse(end+'T00:00:00Z')+86400000)/1000);
 const url=new URL('/v8/finance/chart/'+encodeURIComponent(symbol),base);
 url.searchParams.set('period1',String(period1));
 url.searchParams.set('period2',String(period2));
 url.searchParams.set('interval','1d');
 url.searchParams.set('includePrePost','false');
 return {symbol,year,start,end,url:url.toString()};
}
