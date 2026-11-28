import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scanner=readFileSync(new URL('../app/api/scanner/route.ts',import.meta.url),'utf8');
test('scanner binds excluded symbols as one PostgreSQL text-array parameter',()=>{
 assert.match(scanner,/symbol = ANY\(\$1::text\[\]\)/);
 assert.match(scanner,/\[EXCLUDED_SYMBOLS\]/);
 assert.doesNotMatch(scanner,/\[\.\.\.EXCLUDED_SYMBOLS\]/);
});
