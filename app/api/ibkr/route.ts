import {NextRequest} from 'next/server';
import {authorized} from '../../../lib/auth';
import {gatewayStatus} from '../../../lib/ibkr';
export async function GET(req:NextRequest){
 if(!authorized(req))return Response.json({error:'Unauthorized'},{status:401});
 return Response.json({mode:'READ_ONLY',realOrdersEnabled:false,localPaperOnly:true,ibkr:await gatewayStatus()});
}
