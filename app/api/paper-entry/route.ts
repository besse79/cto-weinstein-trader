import {NextRequest} from 'next/server';
import {authorized} from '../../../lib/auth';
import {computeCandidates} from '../paper-candidates/route';
import {POST as order} from '../orders/route';

/** Execute PAPER only. Re-screen every attempt; never trust client-provided
 * price, stop, quantity, eligibility or ranking. Existing order handler
 * serializes ledger mutations under a transaction advisory lock.
 */
export async function POST(request:NextRequest){
 if(!authorized(request))
  return Response.json({error:'Unauthorized'},{status:401});
 let body:unknown;
 try{body=await request.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}
 if(!body||typeof body!=='object'||Array.isArray(body))
  return Response.json({error:'Invalid paper selection'},{status:400});
 const symbol=(body as Record<string,unknown>).symbol;
 if(typeof symbol!=='string'||!/^[A-Z0-9.\-]{1,24}$/.test(symbol))
  return Response.json({error:'Invalid symbol'},{status:400});
 try{
  const state=await computeCandidates();
  const candidate=state.candidates.find(x=>x.symbol===symbol);
  if(!candidate||!candidate.eligible||candidate.quantity<1)
   return Response.json({error:'PAPER entry blocked: no currently eligible confirmed signal',
    reasons:candidate?.reasons??['SYMBOL_UNAVAILABLE']},{status:409});
  const internal=new NextRequest(request.url,{
   method:'POST',
   headers:{'content-type':'application/json','x-app-token':process.env.APP_TOKEN??''},
   body:JSON.stringify({instrumentId:candidate.id,side:'BUY',
    qty:candidate.quantity,price:candidate.quotePrice,stop:candidate.stop,fee:candidate.fee})
  });
  const result=await order(internal);
  if(!result.ok)return result;
  const committed=await result.json();
  return Response.json({...committed,symbol,quantity:candidate.quantity,
   referencePrice:candidate.quotePrice,referenceDay:candidate.quoteDay,
   stop:candidate.stop,mode:'PAPER',
   executionNote:'Fictional buy at last completed close, not a live quote or market-open execution.'});
 }catch(e){
  return Response.json({error:'Paper entry unavailable',detail:String(e)},{status:503});
 }
}
