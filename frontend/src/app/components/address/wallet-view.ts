import type { ChainStats, Transaction } from '@interfaces/electrs.interface';
export interface WalletFact { id: string; label: string; value: number | string | null; amount?: boolean; signed?: boolean; meaning: string; details: string; }
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const number = (n: unknown): number | null => valid(n) ? n : null;
const difference = (a: unknown, b: unknown): number | null => valid(a) && valid(b) ? a - b : null;
const count = (n: number) => n.toLocaleString('en-US');
const btc = (n: number) => (n / 100000000).toLocaleString('en-US',{maximumFractionDigits:8}) + ' BTC';
export function walletView(chain: ChainStats | null, pending: ChainStats | null) {
  const balance = difference(chain?.funded_txo_sum, chain?.spent_txo_sum);
  const net = difference(pending?.funded_txo_sum,pending?.spent_txo_sum);
  const pendingCount = number(pending?.tx_count);
  const row = (id: string,label: string,value: number | string | null,meaning: string,details: string,amount=false,signed=false): WalletFact => ({id,label,value,meaning,details,amount,signed});
  const rows = [
    row('balance','Confirmed balance',balance,'Confirmed bitcoin assigned to this address, before pending activity.','Confirmed outputs received minus outputs spent in confirmed transactions. Pending spending may already commit some outputs. This does not prove control of the keys or that every output can be spent immediately.',true),
    row('pending','Pending change',net,'Net effect of unconfirmed receipts and spending.','Pending received minus the original value of outputs being spent. A zero net amount can hide activity in both directions. Replacements, confirmations and dropped transactions can change it.',true,true),
    row('incoming','Pending received',number(pending?.funded_txo_sum),'Unconfirmed outputs to this address, including possible change.','This is the total output value assigned to this address in observed pending transactions. It may include your own change. It is not yet confirmed and is not a guarantee of final receipt.',true),
    row('outgoing','Pending spent outputs',number(pending?.spent_txo_sum),'Original value of this address’s outputs used by pending transactions.','This is not necessarily the amount paid to someone else: a transaction consumes whole outputs and may return change to this or another address. Open its transaction page to inspect recipients, change and fees.',true),
    row('pending-txs','Pending transactions',pendingCount,'Transactions still waiting for a block at this provider.','A pending transaction is not confirmed. Find its fee rate, confirmation estimate and available fee-bump options on the transaction detail page. A wallet or exchange may require several confirmations before crediting funds.'),
    row('confirmed-txs','Confirmed transactions',number(chain?.tx_count),'Confirmed transactions involving this address.','Transactions can contain receipts, spending, or change. This is not a count of people or purchases. More block confirmations add assurance, but your receiving service sets its own crediting policy.'),
    row('received','Total received',number(chain?.funded_txo_sum),'All confirmed output value received over this address’s history.','This lifetime total includes change and bitcoin that has since been spent. It is not current balance, income, profit or a full-wallet total.',true),
    row('spent','Total spent outputs',number(chain?.spent_txo_sum),'Original value of outputs spent in confirmed transactions.','Whole outputs become inputs when spent. Value may go to recipients, return as change, or pay miners. This total does not equal purchases or money paid to other people.',true)
  ];
  const deeper = [
    row('utxos','Confirmed UTXOs',difference(chain?.funded_txo_count,chain?.spent_txo_count),'Individual confirmed outputs not spent in confirmed transactions.','Think of outputs as pieces your wallet selects to fund a payment. Pending transactions may already spend some of them. Combining many inputs can increase transaction size and therefore the fee.'),
    row('projected','Balance if pending confirms',balance !== null && net !== null ? balance+net : null,'Confirmed balance plus the current net pending change.','A projection for this address only, assuming all currently observed pending transactions confirm unchanged. It is not a spendable-balance guarantee; wallet policy, scripts, maturity and pending conflicts also matter.',true),
    row('received-outputs','Received outputs',number(chain?.funded_txo_count),'Count of confirmed outputs assigned to this address.','One transaction may create several outputs to the same address. Output counts and transaction counts measure different things; neither identifies an owner.'),
    row('spent-outputs','Spent outputs',number(chain?.spent_txo_count),'Count of those outputs spent in confirmed transactions.','Subtract this from received outputs to obtain the confirmed unspent-output count. Pending spends are counted separately until confirmed.'),
    row('pending-outputs','Pending output change',difference(pending?.funded_txo_count,pending?.spent_txo_count),'Net change to output count if current pending activity confirms.','Unconfirmed outputs added to this address minus existing outputs used as inputs. This is an output count, not an amount of bitcoin.',false,true),
    row('format','Address type','format','The script format, not an owner or trust rating.','Legacy, SegWit and Taproot formats describe spending conditions and influence transaction size. They do not establish ownership or safety. Revealed scripts and available Taproot tools remain below.')
  ];
  // Put pending-payment questions ahead of lifetime accounting totals.
  const snapshotRows = [rows[0], rows[2], rows[4], rows[3], rows[1], deeper[1]];
  const deeperRows = [rows[6], rows[7], rows[5], deeper[0], deeper[2], deeper[3], deeper[4], deeper[5]];
  let summary = balance === null ? 'Confirmed balance is currently unavailable.' : balance === 0 ? 'This address currently has no confirmed balance.' : 'This address has ' + btc(balance) + ' in confirmed outputs.';
  if (pendingCount !== null) summary += pendingCount === 0 ? ' No pending transactions are currently observed.' : ' ' + count(pendingCount) + ' pending ' + (pendingCount === 1 ? 'transaction' : 'transactions') + (net === null ? ' currently involve this address.' : net > 0 ? ' would add a net ' + btc(net) + ' if confirmed unchanged.' : net < 0 ? ' would reduce its balance by a net ' + btc(-net) + ' if confirmed unchanged.' : ' currently have no net effect on its balance.');
  summary += ' This is one address, not necessarily your whole wallet; change may be held at other addresses.';
  const questions = [
    {id:'arrived',label:'Where is my payment?',text:'Open View pending payments or find the transaction in Transaction History. Match the transaction ID, the output to this exact address, and the amount you expected. Pending means the provider has seen it but no block includes it yet. If it is missing, check the sender’s withdrawal status and transaction ID; an exchange may not have broadcast it. A missing entry here does not prove the payment failed.'},
    {id:'missing',label:'Why is my balance different?',text:'This page shows one address. Your wallet may combine many receiving and change addresses, include pending funds, or display another account or network. Bitcoin payments consume whole outputs and usually return the remainder to a change address in the same wallet. A zero balance here does not mean the wallet is empty. Compare the exact address and transaction ID with your wallet’s records.'},
    {id:'spend',label:'When can I use these funds?',text:'A pending payment has not confirmed yet. After it confirms, your wallet or exchange applies its own confirmation and crediting requirements; six confirmations is not a universal rule. Open the transaction page for its current count and a confirmation alert. Confirmed balance may also include outputs already committed to pending spending or subject to script or mining-reward restrictions. Only a wallet with the necessary keys can spend.'}
  ];
  return {balance,net,pendingCount,rows:snapshotRows,deeper:deeperRows,summary,questions};
}
/** Address-specific net change, never a transaction-wide output total. */
export function addressTransactionChange(tx: Transaction, address: string): number | null {
  const relevantInputs = (tx.vin || []).filter(v=>v.prevout?.scriptpubkey_address===address);
  const incoming = (tx.vout || []).filter(v=>v.scriptpubkey_address===address).reduce((sum,v)=>sum+v.value,0);
  if (!(tx.vin || []).every(v=>v.is_coinbase || !!v.prevout)) return null;
  return incoming - relevantInputs.reduce((sum,v)=>sum+v.prevout.value,0);
}
