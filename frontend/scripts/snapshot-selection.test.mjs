import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionSnapshot } from '../src/app/components/transaction/transaction-snapshot.ts';
import { replacementHistoryCount } from '../src/app/components/transaction/transaction-guidance.ts';
const tx={weight:800,fee:400,vin:[{sequence:0xfffffffd}],vout:[{value:1000}],status:{confirmed:false}};
test('pending snapshot has six useful fields without duplicate status or waiting',()=>{
 const facts=transactionSnapshot(tx,100,1700000000,false,undefined,1,600000);
 assert.deepEqual(facts.map(f=>f.label),['Estimated confirmation','First seen','Network fee','Fee rate','Total output','Inputs / outputs']);
 assert.equal(facts[0].value,'About 10 minutes');
 assert.ok(facts[1].secondary);
});
test('confirmed fields depend on available miner and valid observed interval',()=>{
 const confirmed={...tx,status:{confirmed:true,block_height:100,block_time:1700000600}};
 assert.equal(transactionSnapshot(confirmed).length,6);
 const facts=transactionSnapshot(confirmed,105,1700000000,false,'Example pool');
 assert.equal(facts.length,8);
 assert.equal(facts.find(f=>f.label==='Observed confirmation duration').value,'10 minutes');
 assert.equal(transactionSnapshot(confirmed,105,1700000700,false,'Example pool').length,7);
});
test('package fee context is an additional observed fact, including a real zero',()=>{
 assert.equal(transactionSnapshot(tx,undefined,undefined,false,undefined,undefined,undefined,0).at(-1).value,'0 sat/vB');
 assert.equal(transactionSnapshot(tx,undefined,undefined,false,undefined,undefined,undefined,NaN).length,6);
 const coinbase={...tx,vin:[{is_coinbase:true}]};
 assert.equal(transactionSnapshot(coinbase,undefined,undefined,false,undefined,undefined,undefined,1).length,6);
});
test('replacement estimate never implies the original should keep waiting',()=>{
 assert.equal(transactionSnapshot(tx,undefined,undefined,true,undefined,undefined,600000)[0].value,'Not applicable');
});
test('RBF signaling or a single version does not create replacement history',()=>{
 assert.equal(replacementHistoryCount(undefined),0);
 assert.equal(replacementHistoryCount({tx:{txid:'a'},replaces:[]}),0);
 const old={tx:{txid:'b'},replaces:[]};
 const root={tx:{txid:'a'},replaces:[old,old]};
 assert.equal(replacementHistoryCount(root),1);
 old.replaces.push(root);
 assert.equal(replacementHistoryCount(root),1);
});

test('displayed fee rate matches Mempool for fractional virtual size',()=>{
 const facts=transactionSnapshot({...tx,weight:437,fee:330});
 assert.equal(facts.find(f=>f.label==='Fee rate').value,'3.02 sat/vB');
});

test('compact observed times retain the precise UTC timestamp in explanation data',()=>{
 const first=transactionSnapshot(tx,100,1700000000).find(f=>f.label==='First seen');
 assert.equal(first.exactValue,'2023-11-14 22:13:20 UTC');
 assert.match(first.value,/14 Nov(?: 2023)? · 22:13 UTC/);
 const missing=transactionSnapshot(tx).find(f=>f.label==='First seen');
 assert.equal(missing.value,'Not available');
 assert.equal(missing.exactValue,undefined);
 const confirmed=transactionSnapshot({...tx,status:{confirmed:true,block_height:100,block_time:1700000600}}).find(f=>f.label==='Confirmed at');
 assert.equal(confirmed.exactValue,'2023-11-14 22:23:20 UTC');
});
