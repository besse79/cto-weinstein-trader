import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGatewayAuth} from '../lib/ibkr-auth.mjs';
test('nested IBKR status is authenticated',()=>assert.equal(parseGatewayAuth({success:{value:{authenticated:true,connected:true,established:true}}}),true));
test('nested status fails when disconnected or incomplete',()=>{
 for(const value of [{authenticated:false,connected:true},{authenticated:true,connected:false},{authenticated:true,connected:true,established:false}]) {
   assert.equal(parseGatewayAuth({success:{value}}),false);
 }
});
test('legacy gateway response still recognized',()=>assert.equal(parseGatewayAuth({authenticated:true,connected:true}),true));
test('malformed payload fails closed',()=>{
 for(const value of [null,{},[],{success:{value:{authenticated:'true'}}}])
   assert.equal(parseGatewayAuth(value),false);
});
