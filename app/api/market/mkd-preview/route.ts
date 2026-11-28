import {NextRequest} from 'next/server';
import {pool} from '../../../../lib/db';
import {getPreviewBars,fetchMkdObservations,fetchMkdFx,MkdInvalidData,MkdUnavailable} from '../../../../src/mkd-readonly.mjs';
import {previewUsdPaperSize,valueUsdPaperPosition} from '../../../../src/fx-valuation.mjs';
export const dynamic='force-dynamic';

/** Research-only W V4.2-A: local reads or MKD preview. No order/DDL/DML. */
export async function GET(req:NextRequest){
 const url=req.nextUrl;
 const symbol=url.searchParams.get('symbol')||'';
 const mic=url.searchParams.get('mic')||'';
 const start=url.searchParams.get('start')||'';
 const end=url.searchParams.get('end')||'';
 const asOf=url.searchParams.get('as_of')||new Date().toISOString();
 if(!/^[A-Z0-9.^-]{1,24}$/.test(symbol)||!/^[A-Z0-9]{4}$/.test(mic)||
  !/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||
  !Number.isFinite(Date.parse(asOf))||Date.parse(asOf)>Date.now()||
  start>end||end>asOf.slice(0,10)||
  Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z')>366*86400000)
  return Response.json({error:'Invalid symbol, MIC, interval or as_of'},{status:400});
 const enabled=process.env.MKD_READ_ONLY_ENABLED==='true';
 const localRead=async()=>{
  const match=(await pool.query("SELECT id,symbol,name,currency FROM instruments WHERE symbol=$1",[symbol])).rows;
  if(match.length!==1||!['EUR','USD'].includes(match[0].currency))
   throw new MkdInvalidData('Local instrument unavailable or unsupported currency');
  const i=match[0];
  const rows=(await pool.query(`SELECT day::text AS day,open::float8 AS open,
    high::float8 AS high,low::float8 AS low,close::float8 AS close,volume::int AS volume
    FROM candles WHERE instrument_id=$1 AND day>=$2::date AND day<=$3::date
      AND day<=$4::date ORDER BY day LIMIT 1001`,
    [i.id,start,end,asOf.slice(0,10)])).rows;
  if(rows.length>1000||rows.length===0)
   throw new MkdInvalidData('Local bar history empty or exceeds preview limit');
  return {symbol,mic,name:i.name,currency:i.currency,asOf,
   bars:rows,latest:rows.at(-1).day};
 };
 try{
  if(url.searchParams.get('mode')==='observed'){
   const observed=await fetchMkdObservations({baseUrl:process.env.MKD_API_URL||'http://127.0.0.1:8100',symbol,mic,start,end,asOf});
   return Response.json({...observed,mode:'RESEARCH_ONLY',ordersEnabled:false,operationalScanner:'W_LOCAL_UNCHANGED'},{headers:{'Cache-Control':'no-store'}});
  }
  const result=await getPreviewBars({
   enabled,baseUrl:process.env.MKD_API_URL||'',symbol,mic,start,end,
   asOf,localRead
  });
  const response:Record<string,unknown>={
   mode:'PAPER_RESEARCH_ONLY',ordersEnabled:false,
   operationalScanner:'W_LOCAL_UNCHANGED',...result
  };
  if(result.currency==='USD'){
   response.fxStatus='UNAVAILABLE';response.fxPreview=null;
   if(enabled&&result.source==='MKD'){
    try{
     const fx=await fetchMkdFx({baseUrl:process.env.MKD_API_URL||'',
       date:result.latest,asOf});
     response.fxStatus='VERIFIED_MKD';
     response.fxPreview=fx;
     const stopParam=url.searchParams.get('hypothetical_stop_usd');
     if(stopParam!==null){
      const stop=Number(stopParam);
      response.hypotheticalSizing=previewUsdPaperSize({
       equityEur:500,cashEur:500,entryUsd:Number(result.bars.at(-1).close),
       stopUsd:stop,eurUsdRate:fx.rate
      });
      response.hypotheticalValuation=valueUsdPaperPosition({
       qty:1,priceUsd:Number(result.bars.at(-1).close),rateEurUsd:fx.rate
      });
     }
    }catch(e){
     if(!(e instanceof MkdInvalidData)&&!(e instanceof MkdUnavailable))throw e;
     response.fxReason=String(e);
     // No invented rates, and no USD trades. The exchange rate remains blocked.
    }
   }
  }
  return Response.json(response,{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  return Response.json({
   error:'Read-only MKD/local preview unavailable',detail:String(e),
   ordersEnabled:false,operationalScanner:'W_LOCAL_UNCHANGED'
  },{status:503});
 }
}
