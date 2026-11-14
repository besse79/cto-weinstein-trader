/**
 * Yahoo Finance chart adapter for personal PAPER research.
 * The Yahoo chart endpoint is unofficial, unauthenticated and not guaranteed.
 * A bounded daily close-only worker may call it under applicable permissions;
 * no aggressive intraday polling, scraping evasion or proxy rotation.
 */
export const YAHOO_PROVIDER='YAHOO_UNOFFICIAL';
export const HISTORY_RANGE='5y';
export const DAILY_INTERVAL='1d';

export function yahooChartUrl(symbol,base='https://query1.finance.yahoo.com',range=HISTORY_RANGE){
 if(!['5y','3mo'].includes(range))throw new Error('Invalid chart history window');
 if(typeof symbol!=='string'|| !/^[A-Z0-9.^-]{1,24}$/.test(symbol))
  throw new Error('Invalid market symbol');
 const url=new URL('/v8/finance/chart/'+encodeURIComponent(symbol),base);
 url.searchParams.set('range',range);
 url.searchParams.set('interval',DAILY_INTERVAL);
 url.searchParams.set('includePrePost','false');
 return url.toString();
}
function localDate(timestamp,zone){
 if(!Number.isSafeInteger(timestamp)||timestamp<946684800||timestamp>4102444800)
  throw new Error('Invalid chart timestamp');
 const date=new Date(timestamp*1000);
 return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
  .format(date).replace(/^(\d\d)\/(\d\d)\/(\d{4})$/,'$3-$1-$2');
}
function validDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(day+'T12:00:00Z'))}
/**
 * Conservative EOD gate for today's daily candle. A fixed delay after the
 * NORMAL cash-session close avoids storing Yahoo's still-forming daily bar.
 * Unknown exchanges are intentionally previous-day-only.
 *
 * Europe: 19:30 local (>= 2 h after common 17:30 closures).
 * New York: 17:30 local (>= 90 min after 16:00 ET close).
 * Exchange holidays/missing updates are handled by freshness checks, not
 * guessed to have traded. No intraday bars are ever accepted.
 */
export function isDailySessionClosed(now,zone){
 if(!(now instanceof Date)||!Number.isFinite(+now))return false;
 const thresholds={
  'America/New_York':17*60+30,
  'Europe/Paris':19*60+30,
  'Europe/Berlin':19*60+30,
  'Europe/Zurich':19*60+30,
  'Europe/London':18*60+30,
  'Europe/Stockholm':19*60+30,
  'Europe/Oslo':19*60+30,
  'Europe/Copenhagen':19*60+30,
  'Europe/Warsaw':19*60+30,
  'Europe/Amsterdam':19*60+30,
  'Europe/Brussels':19*60+30,
  'Europe/Helsinki':20*60+30,
  'Europe/Madrid':19*60+30,
  'Europe/Rome':19*60+30
 };
 const threshold=thresholds[zone];
 if(threshold===undefined)return false;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  weekday:'short'
 }).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 if(['Sat','Sun'].includes(parts.weekday))return false;
 return Number(parts.hour)*60+Number(parts.minute)>=threshold;
}

export function parseYahooChart(json,{symbol,currency,asOf=new Date()}){
 const item=json?.chart?.result?.[0];
 if(json?.chart?.error||!item||!Array.isArray(json.chart.result)||json.chart.result.length!==1)
  throw new Error('Yahoo Finance chart unavailable');
 const meta=item.meta||{};
 if(meta.symbol!==symbol || meta.currency!==currency)
  throw new Error('Yahoo ticker/currency mismatch; import blocked');
 const zone=meta.exchangeTimezoneName;
 if(typeof zone!=='string'||zone.length>70)throw new Error('Missing exchange timezone');
 try{new Intl.DateTimeFormat('en-US',{timeZone:zone})}catch{throw new Error('Invalid exchange timezone')}
 const quotes=item.indicators?.quote?.[0],ts=item.timestamp;
 if(!quotes||!Array.isArray(ts)||ts.length<40||ts.length>3500)
  throw new Error('Yahoo history is insufficient or malformed');
 for(const k of ['open','high','low','close','volume'])
  if(!Array.isArray(quotes[k])||quotes[k].length!==ts.length)throw new Error('Incomplete OHLCV columns');
 const now=asOf instanceof Date?asOf:new Date(asOf);
 if(Number.isNaN(+now))throw new Error('Invalid asOf');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
  .format(now).replace(/^(\d\d)\/(\d\d)\/(\d{4})$/,'$3-$1-$2');
 const dates=new Set(),bars=[];
 for(let i=0;i<ts.length;i++){
  const day=localDate(ts[i],zone);
  if(!validDay(day)||dates.has(day))throw new Error('Duplicate or invalid market day');
  dates.add(day);
  if(day>today||day===today&&!isDailySessionClosed(now,zone))continue; // Never import a still-forming daily bar.
  const [open,high,low,close,volume]=['open','high','low','close','volume'].map(k=>quotes[k][i]);
  // Exchanges sometimes return nulls for non-trading/placeholder dates; omit them.
  if([open,high,low,close,volume].every(v=>v===null))continue;
  if(![open,high,low,close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0) ||
     high<Math.max(open,low,close)||low>Math.min(open,close) ||
     !Number.isSafeInteger(volume)||volume<0)throw new Error('Invalid Yahoo OHLCV; import blocked');
  bars.push({day,open,high,low,close,volume});
 }
 bars.sort((a,b)=>a.day.localeCompare(b.day));
 if(bars.length<40)throw new Error('Insufficient completed history');
 const latest=bars.at(-1).day;
 const lag=(now-Date.parse(latest+'T12:00:00Z'))/86400000;
 if(lag>10||lag<0)throw new Error('Yahoo last candle is stale or future dated');
 return {bars,symbol,currency,first:bars[0].day,last:latest,
   provider:YAHOO_PROVIDER,adjustment:'Yahoo chart OHLCV (dividend adjustment not independently verified)'};
}
