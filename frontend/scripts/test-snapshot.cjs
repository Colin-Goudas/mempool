const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const source=fs.readFileSync('src/app/components/transaction/transaction-snapshot.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod=new Module('snapshot');mod._compile(compiled,'snapshot.js');
const {transactionSnapshot,transactionSummary}=mod.exports;
const base={txid:'a'.repeat(64),weight:1668,fee:3440,vin:[{is_coinbase:false}],vout:Array(8).fill({value:1000}),status:{confirmed:true,block_height:900000,block_time:1749188499}};
const fact=(rows,label)=>rows.find(r=>r.label===label);
test('confirmed data uses current tip and exact virtual-size fee rate',()=>{
 const rows=transactionSnapshot(base,900005,0,false,'ViaBTC');
 assert.equal(fact(rows,'Confirmations').value,'6');
 assert.equal(fact(rows,'Network fee').value,'3,440 sats');
 assert.equal(fact(rows,'Fee rate').value,'8.25 sat/vB');
 assert.equal(fact(rows,'Mining pool').value,'ViaBTC');
 assert.match(fact(rows,'Inputs / outputs').meaning,/not necessarily the payment amount/);
});
test('pending does not invent time, block or confirmations',()=>{
 const tx={...base,status:{confirmed:false}};
 const rows=transactionSnapshot(tx);
 assert.equal(fact(rows,'Confirmations').value,'0');
 assert.equal(fact(rows,'First seen').value,'Not available');
 assert.equal(fact(rows,'Included in block'),undefined);
 assert.match(transactionSummary(tx),/cannot be guaranteed/);
});
test('coinbase and replacement are distinguished from normal payments',()=>{
 assert.equal(fact(transactionSnapshot({...base,vin:[{is_coinbase:true}]}),'Network fee').value,'Not applicable');
 assert.equal(fact(transactionSnapshot({...base,status:{confirmed:false}},undefined,undefined,true),'Status').value,'Replaced');
 assert.match(transactionSummary({...base,vin:[{is_coinbase:true}]}),/mining reward/);
});
test('missing numeric data remains unavailable, invalid tip never gives negative confirmations',()=>{
 assert.equal(fact(transactionSnapshot({...base,fee:null,weight:0},899999),'Fee rate').value,'Not available');
 assert.equal(fact(transactionSnapshot(base,899999),'Confirmations').value,'Checking latest block…');
 assert.deepEqual(transactionSnapshot(undefined),[]);
});
test('replacement transition cancels the pending summary and cannot fetch a stale one',()=>{
 const componentSource=fs.readFileSync('src/app/components/transaction-explanation/transaction-explanation.component.ts','utf8');
 const js=ts.transpileModule(componentSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const c=new Module('explanation');
 c.require=id=>id==='@angular/core'?{Component:()=>target=>target,Input:()=>()=>{}}:id==='@angular/common'?{CommonModule:class{}}:id==='@angular/common/http'?{}:require(id);
 c._compile(js,'explanation.js');
 let calls=0,cancelled=false;
 const component=new c.exports.TransactionExplanationComponent({post:()=>{calls++;return{subscribe:()=>({unsubscribe:()=>{cancelled=true}})}}});
 component.txid='a'.repeat(64);component.confirmed=false;component.ngOnChanges({txid:{}});
 component.explanation='Still awaiting confirmation';component.replaced=true;component.ngOnChanges({replaced:{}});
 assert.equal(cancelled,true);assert.equal(component.explanation,'');assert.equal(component.loading,false);
 component.explain();assert.equal(calls,1);
});
