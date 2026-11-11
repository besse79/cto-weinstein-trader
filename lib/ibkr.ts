import {gatewayBase} from './ibkr-readonly.mjs';
// Status check only. No order, account mutation, or trade endpoints.
export async function gatewayStatus(){
 const base=gatewayBase(process.env.IBKR_GATEWAY_URL);
 if(!base)return {connected:false,reason:'Local IBKR gateway not configured'};
 try{
  const r=await fetch(base+'/iserver/auth/status',{method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {connected:false,reason:'IBKR gateway HTTP '+r.status};
  const json=await r.json();
  return {connected:json.authenticated===true,authenticated:json.authenticated===true};
 }catch{return {connected:false,reason:'Local gateway unreachable or TLS validation failed'}}
}
