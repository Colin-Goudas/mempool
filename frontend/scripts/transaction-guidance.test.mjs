import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionNextStep} from '../src/app/components/transaction/transaction-guidance.ts';
const base={confirmed:false,confirmations:0,coinbase:false,replaced:false,conflict:false,cached:false,connected:true};
test('pending guidance allows waiting without guaranteeing inclusion or universal fee-bump support',()=>{const s=transactionNextStep(base);assert.match(s,/can wait/);assert.match(s,/sending wallet|sending exchange/);assert.doesNotMatch(s,/safe|guarantee/);});
test('confirmed guidance distinguishes blockchain confirmation from account crediting',()=>assert.match(transactionNextStep({...base,confirmed:true,confirmations:1}),/receiving service’s confirmation requirements/));
test('replaced and conflicting transactions never receive normal waiting guidance',()=>{for(const state of [{replaced:true},{conflict:true}])assert.match(transactionNextStep({...base,...state}),/replacement or conflicting/);});
test('cached and disconnected states do not imply current mempool presence',()=>{assert.match(transactionNextStep({...base,cached:true}),/cached record/);assert.match(transactionNextStep({...base,connected:false}),/Reconnect/);});
test('mining reward guidance uses the 100-confirmation maturity boundary',()=>{assert.match(transactionNextStep({...base,coinbase:true,confirmed:true,confirmations:99}),/need 100/);assert.match(transactionNextStep({...base,coinbase:true,confirmed:true,confirmations:100}),/threshold has been reached/);});
