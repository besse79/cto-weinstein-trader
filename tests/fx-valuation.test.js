import test from 'node:test';
import assert from 'node:assert/strict';
import {convertUsdToEur,convertEurToUsd,previewUsdPaperSize,
  valueUsdPaperPosition} from '../src/fx-valuation.mjs';
test('FX conversion EUR/USD has one unambiguous direction',()=>{
 assert.equal(convertUsdToEur(110,1.1),100);
 assert.equal(convertEurToUsd(100,1.1),110.00000000000001);
 assert.equal(valueUsdPaperPosition({qty:1,priceUsd:110,rateEurUsd:1.1}).marketValueEur,100);
});
test('PAPER USD sizing enforces one percent risk and 25 percent allocation',()=>{
 const valid=previewUsdPaperSize({
  equityEur:500,cashEur:500,entryUsd:50,stopUsd:49,eurUsdRate:1.1});
 assert.equal(valid.quantity,2);
 assert.equal(valid.riskBudgetEur,5);
 assert.equal(valid.executable,false);
 assert.equal(valid.mode,'PAPER_RESEARCH_ONLY');
 assert.ok(valid.maxPlannedLossEur<=5);
 const rejected=previewUsdPaperSize({
  equityEur:500,cashEur:500,entryUsd:95,stopUsd:77,eurUsdRate:1.1});
 assert.equal(rejected.quantity,0);
 assert.equal(rejected.reason,'INSUFFICIENT_CAPITAL_OR_RISK');
 assert.equal(rejected.executable,false);
});
test('zero, stale/unavailable rate and upside-down stops fail closed',()=>{
 assert.throws(()=>convertUsdToEur(10,0),/rate/);
 assert.throws(()=>previewUsdPaperSize({
  equityEur:500,cashEur:500,entryUsd:50,stopUsd:40,eurUsdRate:NaN}),/rate/);
 assert.throws(()=>previewUsdPaperSize({
  equityEur:500,cashEur:500,entryUsd:40,stopUsd:50,eurUsdRate:1.1}),/Invalid/);
 assert.throws(()=>valueUsdPaperPosition({qty:-1,priceUsd:50,rateEurUsd:1.1}),/Invalid/);
});
