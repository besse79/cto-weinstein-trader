/** Normalize IBKR brokerage authentication status without accepting partial sessions. */
export function parseGatewayAuth(payload) {
 const status=payload?.success?.value ?? payload;
 return status?.authenticated===true && status?.connected!==false && status?.established!==false;
}
