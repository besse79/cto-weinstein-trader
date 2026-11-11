import {NextRequest} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
export function authorized(req:NextRequest):boolean {
 const secret=process.env.APP_TOKEN||'';
 const provided=req.headers.get('x-app-token')||'';
 const a=Buffer.from(secret),b=Buffer.from(provided);
 return a.length>0&&a.length===b.length&&timingSafeEqual(a,b);
}
