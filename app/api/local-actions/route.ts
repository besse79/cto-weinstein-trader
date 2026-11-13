import {NextRequest} from 'next/server';
import {POST as sync} from '../market/sync/route';
import {POST as order} from '../orders/route';

export const dynamic='force-dynamic';
const localHosts=new Set(['localhost:3010','127.0.0.1:3010']);

/**
 * User-triggered actions for a desktop-only app bound to 127.0.0.1.
 * Browser NEVER receives APP_TOKEN: we add it only to an internal request
 * that is passed directly to the existing authenticated handlers.
 * Cross-origin requests / DNS rebinding are rejected before processing.
 */
export async function POST(request:NextRequest){
 const host=request.headers.get('host')?.toLowerCase()??'';
 const origin=request.headers.get('origin')??'';
 const fetchSite=request.headers.get('sec-fetch-site');
 if(!localHosts.has(host)||origin!==`http://${host}`||
    (fetchSite!==null&&fetchSite!=='same-origin'))
  return Response.json({error:'Local same-origin action required'},{status:403});
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
  return Response.json({error:'JSON content type required'},{status:415});
 const key=process.env.APP_TOKEN;
 if(!key)return Response.json({error:'Local application secret missing'},{status:503});
 let payload:Record<string,unknown>;
 try{
  const parsed=await request.json();
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
   return Response.json({error:'Invalid JSON action'},{status:400});
  payload=parsed as Record<string,unknown>;
 }catch{return Response.json({error:'Invalid JSON action'},{status:400})}
 if(payload.action!=='sync'&&payload.action!=='sell')
  return Response.json({error:'Unsupported action'},{status:400});
 const action=payload.action;
 const body=action==='sync'?{symbols:payload.symbols}:{
  instrumentId:payload.instrumentId,qty:payload.qty,price:payload.price,
  side:'SELL',fee:0
 };
 const headers=new Headers({
  'content-type':'application/json',
  'x-app-token':key
 });
 const internal=new NextRequest(request.url,{
  method:'POST',headers,body:JSON.stringify(body)
 });
 return action==='sync'?sync(internal):order(internal);
}
