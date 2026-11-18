import {computeCandidates} from '../../../lib/paper-candidates';
export const dynamic='force-dynamic';

export async function GET(){
 try{
  const result=await computeCandidates();
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  return Response.json({error:'Paper candidate screening unavailable',detail:String(e)},{status:503});
 }
}
