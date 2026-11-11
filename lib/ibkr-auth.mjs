/** Require an active fully connected IBKR brokerage session, fail closed. */
export function parseGatewayAuth(payload) {
 const status=payload?.success?.value ?? payload;
 if(!status || typeof status!=='object')return false;
 return status.authenticated===true &&
   status.connected===true &&
   status.established!==false &&
   status.competing!==true;
}
