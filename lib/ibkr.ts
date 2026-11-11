// Informational connection status only. No broker trading endpoints.
const configured=process.env.IBKR_GATEWAY_URL||'';
export async function gatewayStatus(){
 if(!/^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(configured))
  return {connected:false,reason:'Local IBKR gateway not configured'};
 try{
  const r=await fetch(configured+'/iserver/auth/status',{method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {connected:false,reason:'IBKR gateway HTTP '+r.status};
  const json=await r.json();
  return {connected:!!json.authenticated,authenticated:!!json.authenticated};
 }catch(e){return {connected:false,reason:String(e)}}
}
