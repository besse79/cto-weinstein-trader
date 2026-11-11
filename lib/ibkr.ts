import {parseGatewayAuth} from './ibkr-auth.mjs';
import {gatewayBase} from './ibkr-readonly.mjs';
// Broker auth diagnostic only; no order endpoints.
export async function gatewayStatus(){
 const base=gatewayBase(process.env.IBKR_GATEWAY_URL);
 if(!base)return {connected:false,reason:'Local IBKR gateway not configured'};
 try{
  const r=await fetch(base+'/iserver/auth/status',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {connected:false,reason:'Gateway HTTP '+r.status};
  const json=await r.json();
  return {connected:parseGatewayAuth(json),authenticated:parseGatewayAuth(json)};
 }catch{return {connected:false,reason:'Gateway inaccessible ou certificat TLS non approuvé'}}
}
