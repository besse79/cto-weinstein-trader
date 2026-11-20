import {Pool} from 'pg';
const globalForPool=globalThis as unknown as {ctoPool?:Pool};
export const pool=globalForPool.ctoPool??new Pool({connectionString:process.env.DATABASE_URL});
if(process.env.NODE_ENV!=='production')globalForPool.ctoPool=pool;
