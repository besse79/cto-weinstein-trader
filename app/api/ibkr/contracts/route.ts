import {NextRequest} from 'next/server';
import {authorized} from '../../../../lib/auth';
import {gatewayBase} from '../../../../lib/ibkr-readonly.mjs';
import {pool} from '../../../../lib/db';
import {gatewayStatus} from '../../../../lib/ibkr';
export const dynamic='force-dynamic';

/** Search candidates without saving conids or touching IBKR orders. */
export async function GET(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 const base=gatewayBase(process.env.IBKR_GATEWAY_URL);
 if(!base)return Response.json({error:'Local IBKR gateway not configured'},{status:503});
 const session=await gatewayStatus();
 if(!session.connected)return Response.json({error:'IBKR brokerage session not authenticated'},{status:503});
 const appSymbol=req.nextUrl.searchParams.get('symbol')||'';
 if(!/^[A-Z0-9.\-]{1,15}$/.test(appSymbol))
  return Response.json({error:'Invalid instrument'},{status:400});
 const found=await pool.query('SELECT id,symbol,name,currency FROM instruments WHERE symbol=$1',[appSymbol]);
 if(!found.rows.length)return Response.json({error:'Instrument not in watchlist'},{status:404});
 const shortSymbol=appSymbol.replace(/\.PA$/,'');
 const u=new URL(base+'/iserver/secdef/search');
 u.searchParams.set('symbol',shortSymbol);
 try{
  const response=await fetch(u,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return Response.json({error:'IBKR discovery failed',httpStatus:response.status},{status:502});
  const data=await response.json();
  if(!Array.isArray(data)||data.length>150)throw new Error('Unexpected candidates');
  const candidates=data.filter(x=>x && Number.isSafeInteger(Number(x.conid)) && Number(x.conid)>0)
   .slice(0,25).map(x=>({
     conid:Number(x.conid),
     symbol:String(x.symbol||'').slice(0,32),
     companyName:String(x.companyName||'').slice(0,120),
     description:String(x.description||'').slice(0,100),
     sections:Array.isArray(x.sections)?x.sections.filter(s=>s.secType==='STK').map(s=>({secType:'STK',exchange:String(s.exchange||'').slice(0,100)})):[]
   }));
  return Response.json({provider:'IBKR',mode:'READ_ONLY',instrument:found.rows[0],
    query:shortSymbol,candidates,needsManualVerification:true,
    note:'These are candidates, not an automatically accepted mapping. Verify company, market, currency and security type.'});
 }catch{return Response.json({error:'Contract discovery unavailable'},{status:502})}
}
