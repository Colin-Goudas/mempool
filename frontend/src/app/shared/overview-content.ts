import type { OverviewFact, OverviewQuestion } from './mobile-overview-snapshot.component';
import type { NetworkSnapshot } from '@app/dashboard/network-snapshot';
import { walletView } from '@components/address/wallet-view';
const fmt=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:8});
const btc=(n:number)=>fmt(n/100000000)+' BTC';
const q=(id:string,label:string,title:string,text:string,icon='question'):OverviewQuestion=>({id,label,title,text,icon});
export function walletOverview(view:ReturnType<typeof walletView>){
 const pending=view.pendingCount;
 const lead=pending===null?'Pending status is unavailable.':pending===0?'No pending transactions observed.':pending===1?'One transaction is awaiting confirmation.':fmt(pending)+' transactions are awaiting confirmation.';
 const questions=[
  q('arrived','My payment?','Where is my payment?','Match the transaction ID, the output to this exact address, and the expected amount in Transaction History. A pending entry means this provider has seen it, but it is not in a block yet. If it is missing, ask the sender or exchange for the transaction ID and whether it has been broadcast. An absent entry does not prove failure.','clock'),
  q('missing','Balance?','Why is the balance different?',view.questions.find(v=>v.id==='missing')!.text,'wallet'),
  q('track','Track address','Track this address','Watch activity on this public address while this page stays open and connected. No wallet connection is needed. This watches one address, not an entire wallet.','bell'),
  q('spend','Use funds?','When can these funds be used?',view.questions.find(v=>v.id==='spend')!.text,'wallet'),
  q('confirmations','Confirmed?','When does a payment count as confirmed?','The first confirmation means a miner included the transaction in a block. Each later block adds another confirmation. A wallet or exchange sets its own crediting requirement, so check its policy and open the payment’s transaction page for the current count.','clock'),
  q('privacy','Privacy?','What can this address reveal?','Bitcoin address activity is public. Anyone with this address can inspect its balance and history. This page cannot prove who owns it. Wallets commonly use separate receiving and change addresses; avoid treating one address as a person’s complete balance.','shield')
 ];
 const paragraphs=[
  view.net===null?'The net effect of pending activity is unavailable.':pending===0?'There is no pending balance change observed at this address.':view.net===0?'Pending receipts and spending currently have no net effect on this address’s balance; activity may still exist in both directions.':`If the observed pending transactions confirm unchanged, this address’s balance would ${view.net>0?'increase':'decrease'} by a net ${btc(Math.abs(view.net))}. This is a projection, not a spendable balance.`,
  'Find the payment in Transaction History below, then open its transaction page to check the receiving output, confirmation count, fee and estimated wait. An explorer cannot see a withdrawal that an exchange has not broadcast.',
  'Confirmed balance is not a guarantee that every output is available to spend. Pending spending may already use some outputs, and the wallet or exchange controls crediting and spending rules.',
  'This page shows one Bitcoin address, not necessarily the whole wallet. Other receiving and change addresses may hold the rest. Dollar values use the current price, not the price when a payment happened.'
 ];
 const facts:OverviewFact[]=view.rows.map(f=>({label:f.label,value:f.value===null?'Unavailable':typeof f.value==='number'?(f.signed&&f.value>0?'+':'')+fmt(f.amount?f.value/100000000:f.value):f.value,unit:f.amount&&f.value!==null?'BTC':'',fiatSats:f.amount&&typeof f.value==='number'?f.value:undefined,meaning:f.meaning,details:f.details}));
 return {lead,paragraphs,questions,facts};
}
export function networkOverview(snapshot:NetworkSnapshot){
 const fast=snapshot.sending[0]?.rate;const economy=snapshot.sending[1]?.rate;
 const lead=snapshot.reconnecting?'Reconnecting to live network data.':fast===null||fast===undefined?'Current fee estimates are unavailable.':snapshot.summaryLead.split('. ')[0]+'.';
 const body=snapshot.reconnecting?'Retained values may be out of date.':fast===null||fast===undefined?'Wait for the live fee feed before comparing confirmation targets.':`The next-block recommendation is ${fmt(fast)} sat/vB${economy===null||economy===undefined?'.':`, or ${fmt(economy)} sat/vB at economy priority if there is no deadline.`}`;
 const questions=[
  q('fee','What fee?','Which fee should I choose?',snapshot.reconnecting?'The live feed is reconnecting, so retained estimates may be stale. Wait for fresh data and check the sending wallet before broadcasting.':`For urgency, the current next-block recommendation is ${fast===null||fast===undefined?'unavailable':fmt(fast)+' sat/vB'}. Economy priority is ${economy===null||economy===undefined?'unavailable':fmt(economy)+' sat/vB'} and has no fixed deadline. Use the sending wallet’s current estimate and review the total before sending. A fee recommendation is not a confirmation guarantee.`,'wallet'),
  q('busy','How busy?','How busy is the network?',snapshot.questions.find(v=>v.id==='busy')!.text,'chart'),
  q('timing','Timing?','How long could a payment take?',snapshot.questions.find(v=>v.id==='timing')!.text,'clock'),
  q('total','Fee total?','How much is the total fee?','Multiply the fee rate in sat/vB by the transaction’s virtual size. The fee pays for block space, not a percentage of the amount sent. The calculator below is illustrative; use the sending wallet’s actual size and review any separate exchange withdrawal charge.','wallet'),
  q('arrived','My payment?','How do I check a specific payment?','Search for its transaction ID or receiving address above. Network fee tiers describe current conditions, not the status or exact wait of a particular payment. If an exchange has not broadcast the withdrawal, it will not appear in this explorer.','question'),
  q('visuals','The visuals','What do the visuals show?',snapshot.questions.find(v=>v.id==='visuals')!.text,'chart')
 ];
 const paragraphs=[
  'Fee tiers target blocks, not deadlines. Bitcoin targets about ten minutes per block over the long term; an individual block can arrive sooner or later, and new higher-fee transactions can change the wait.',
  snapshot.exampleFee===undefined?'A total fee example is unavailable until the fee feed arrives.':`At the current next-block rate, a 140-vB example would cost ${fmt(snapshot.exampleFee)} sats. This is an illustration, not an average payment fee. Actual size depends on inputs, outputs and script types.`,
  `${snapshot.rows.find(r=>r.label==='Awaiting confirmation')?.value||'An unavailable number of'} transactions are shown in this provider’s pending queue. Queue counts alone do not show how much a fast payment needs to pay; fee rates and block-space demand matter.`,
  'For a payment already sent, search its transaction ID for status, confirmations and fee-bump guidance. Projected blocks above are estimates; mined blocks are confirmed history.'
 ];
 const facts:OverviewFact[]=snapshot.rows.map(f=>{const m=f.value.match(/^(.*?)\s+(sat\/vB|sats|vMB|blocks|minutes)$/);return {label:f.label,value:m?m[1]:f.value,unit:m?m[2]:'',fiatSats:f.fiatSats,meaning:f.meaning,details:f.details,accent:f.label==='Next-block fee'};});
 return {lead,body,paragraphs,questions,facts};
}
