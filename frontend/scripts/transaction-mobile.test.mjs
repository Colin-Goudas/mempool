import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileTransactionView, mobileTrackerStage } from '../src/app/components/transaction/transaction-mobile.ts';
test('phone entry uses status and explicit details remains reachable', () => {
 assert.equal(mobileTransactionView(390), 'status');
 assert.equal(mobileTransactionView(767.98), 'status');
 assert.equal(mobileTransactionView(390, 'details'), 'details');
 assert.equal(mobileTransactionView(768, 'details'), 'desktop');
});
test('unknown or cached transactions cannot imply an imminent confirmation', () => {
 assert.equal(mobileTrackerStage(false,false,false,false,0),'waiting');
 assert.equal(mobileTrackerStage(true,false,false,true,0),'waiting');
 assert.equal(mobileTrackerStage(true,false,false,false,undefined),'pending');
 assert.equal(mobileTrackerStage(true,false,false,false,NaN),'pending');
 assert.equal(mobileTrackerStage(true,false,false,false,-1),'pending');
});
test('live progress follows estimates while replacement and confirmation take priority', () => {
 assert.equal(mobileTrackerStage(true,false,false,false,0),'next');
 assert.equal(mobileTrackerStage(true,false,false,false,2),'soon');
 assert.equal(mobileTrackerStage(true,false,false,false,3),'pending');
 assert.equal(mobileTrackerStage(true,true,false,false,0),'confirmed');
 assert.equal(mobileTrackerStage(true,true,true,false,0),'replaced');
});
