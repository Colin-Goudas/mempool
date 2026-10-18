import type { Transaction } from '@interfaces/electrs.interface';

export interface SnapshotFact { label: string; value: string; meaning: string; details: string; }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const number = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Present only observed facts; outputs do not identify a recipient's payment. */
export function transactionSnapshot(tx: Transaction | undefined, tip?: number, firstSeen?: number, replaced = false, miner?: string): SnapshotFact[] {
  if (!tx) return [];
  const coinbase = tx.vin?.some(input => input.is_coinbase);
  const confirmed = tx.status?.confirmed === true;
  const height = tx.status?.block_height;
  const confirmations = confirmed && finite(tip) && finite(height) && tip >= height ? tip - height + 1 : null;
  const vsize = finite(tx.weight) && tx.weight > 0 ? Math.ceil(tx.weight / 4) : null;
  const fee = finite(tx.fee) && tx.fee >= 0 ? tx.fee : null;
  const time = confirmed ? tx.status?.block_time : firstSeen;
  const deeper: Record<string, string> = {
    'Status': 'Unconfirmed transactions can be replaced, dropped or included in a block. Confirmed transactions have a block record; a rare chain reorganization can change that record. A recipient or exchange may require more confirmations before crediting a deposit.',
    'Confirmations': 'This is the latest observed block height minus the containing block height, plus one. There is no universal required count: wallets, exchanges and recipients set their own acceptance policies. More confirmations make a reversal through a chain reorganization progressively less likely.',
    'Confirmed at': 'A block timestamp is supplied by its miner under Bitcoin consensus rules. It records the block’s reported time, not necessarily the exact instant your wallet sent the payment. All times in this snapshot use UTC.',
    'First seen': 'First-seen time comes from the provider’s own observation, rather than a field stored in an unconfirmed Bitcoin transaction. Older records or transactions first seen by a different node may have no retained observation time.',
    'Network fee': 'For an ordinary Bitcoin transaction, the network fee is the sum of the input values minus the sum of the output values. It pays for block space and is not the amount transferred to a recipient. A wallet or exchange may separately charge a service fee that cannot be identified from this transaction alone.',
    'Fee rate': 'Miners generally compare fees relative to transaction size, rather than the total number of sats paid. Virtual size is transaction weight divided by four, rounded up. An unconfirmed parent or child can influence the package’s effective rate; the detailed analysis below shows related transactions when available.',
    'Included in block': 'A block groups validated transactions into Bitcoin’s chain. The block height counts its position from the genesis block. The position arrow in the visualization identifies the containing block; opening a block lets you inspect its other transactions.',
    'Mining pool': 'Pools coordinate miners and commonly identify themselves in a block’s coinbase transaction. The explorer matches that information to a known pool. This identifies the attributed block producer, not the sender, recipient or every individual miner.',
    'Inputs / outputs': 'A Bitcoin transaction consumes previous unspent outputs as inputs and creates new outputs. A wallet often returns unused value to itself as change, and one transaction may pay multiple recipients. The public record alone usually cannot tell which output is your specific payment.',
  };
  return [
    { label: 'Status', value: replaced && !confirmed ? 'Replaced' : confirmed ? 'Confirmed' : 'Unconfirmed', meaning: replaced && !confirmed ? 'A replacement transaction was observed. Follow the replacement link above for its current status.' : confirmed ? 'This transaction is included in a Bitcoin block.' : 'This transaction has not been confirmed. Inclusion and timing are not guaranteed.' },
    { label: 'Confirmations', value: confirmations === null ? (confirmed ? 'Checking latest block…' : '0') : number(confirmations), meaning: confirmed ? 'The containing block counts as the first confirmation. Each later block adds another.' : 'Confirmations begin when a miner includes this transaction in a block.' },
    { label: confirmed ? 'Confirmed at' : 'First seen', value: finite(time) && time > 0 && time < 8.64e12 ? new Date(time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not available', meaning: confirmed ? 'The timestamp reported by the block containing this transaction.' : 'When the observing provider first saw this transaction. Other nodes may report a different time.' },
    { label: 'Network fee', value: coinbase ? 'Not applicable' : fee === null ? 'Not available' : number(fee) + ' sats', meaning: coinbase ? 'This is a mining reward transaction; it does not pay a normal transaction fee.' : 'The fee paid to miners by the whole transaction, separate from its outputs.' },
    { label: 'Fee rate', value: coinbase ? 'Not applicable' : fee !== null && vsize !== null ? number(fee / vsize, 2) + ' sat/vB' : 'Not available', meaning: 'The transaction fee divided by its virtual size. Related transactions can change the effective package fee rate; see deeper details.' },
    ...(confirmed && finite(height) ? [{ label: 'Included in block', value: '#' + number(height), meaning: 'The Bitcoin block that recorded this transaction. The blocks above show its position.' }] : []),
    ...(confirmed ? [{ label: 'Mining pool', value: miner || 'Not identified', meaning: 'The pool identified as mining the containing block. Attribution may not identify every participant.' }] : []),
    { label: 'Inputs / outputs', value: number(tx.vin?.length ?? 0) + ' / ' + number(tx.vout?.length ?? 0), meaning: coinbase ? 'This transaction creates the mining reward. Outputs show how that reward was distributed.' : 'Inputs spend previous outputs. New outputs may include change, so their total is not necessarily the payment amount.' },
  ].map(row => ({ ...row, details: deeper[row.label] }));
}

export function transactionSummary(tx: Transaction | undefined, replaced = false): string {
  if (!tx) return 'Connecting to the Bitcoin transaction data…';
  if (replaced && !tx.status?.confirmed) return 'A replacement was observed for this transaction. Review the replacement link above before relying on its status.';
  if (tx.vin?.some(input => input.is_coinbase)) return 'This is a mining reward transaction. It creates the block subsidy and collects the block’s transaction fees.';
  return tx.status?.confirmed ? (finite(tx.status.block_height) ? 'Your transaction is included in block ' + number(tx.status.block_height) + '.' : 'Your transaction is confirmed.') + ' Review its confirmation status, network fee and recorded details below.' : 'Your transaction has not been confirmed yet. Its fee rate and competing network demand influence when it may be included; a confirmation time cannot be guaranteed.';
}

/** Additional protocol fields, deliberately separate from the quick snapshot. */
export function transactionTechnicalFacts(tx: Transaction | undefined, miner?: string): SnapshotFact[] {
  if (!tx) return [];
  const rows: SnapshotFact[] = [];
  const add = (label: string, value: string, meaning: string, details: string) => rows.push({label, value, meaning, details});
  if (finite(tx.size)) add('Size', number(tx.size) + ' B', 'The full transaction size in bytes.', 'Size measures the serialized transaction data, including witness information when present. Bitcoin block capacity is accounted for using weight, rather than raw bytes alone.');
  if (finite(tx.weight)) {
    add('Virtual size', number(tx.weight / 4, 2) + ' vB', 'The fee-adjusted size used to compare transaction costs.', 'Virtual size equals transaction weight divided by four. Some wallet and fee calculations round this up to the next whole virtual byte.');
    add('Adjusted vsize', number(tx.weight / 4, 2) + ' vB', 'The basic weight-derived virtual size; policy adjustments may differ.', 'This displays the weight-derived virtual size. The upstream explorer can show a different adjusted value for transactions with special signature-operation costs, so it should not be interpreted as a separately verified policy-adjusted measurement.');
    add('Weight', number(tx.weight) + ' WU', 'The transaction’s weight in Bitcoin weight units.', 'Witness data is discounted under SegWit weight rules. Weight determines how much of a block’s permitted capacity a transaction consumes.');
  }
  if (finite(tx.version)) add('Version', number(tx.version), 'Identifies the transaction format version.', 'The version field helps signal how the transaction should be interpreted under Bitcoin consensus rules. It does not identify a wallet or exchange.');
  if (finite(tx.locktime)) add('Locktime', number(tx.locktime), tx.locktime === 0 ? 'No absolute locktime is set.' : 'Specifies an earliest block height or time for finality.', 'A nonzero locktime may restrict when a transaction can be included, depending on input sequence values. Values below 500 million are interpreted as block heights; larger values are Unix timestamps.');
  if (finite(tx.sigops)) add('Sigops', number(tx.sigops), 'Counts signature-checking operations attributed to this transaction.', 'Signature operations are a Bitcoin validation resource. Their accounting can affect policy-adjusted virtual size and transaction acceptance.');
  if (tx.status?.confirmed && finite(tx.status.block_time)) add('Block timestamp', new Date(tx.status.block_time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC'), 'The timestamp recorded in the confirming block.', 'A block timestamp is chosen by the miner within Bitcoin consensus limits. It is not necessarily the precise moment the payment was sent or first broadcast.');
  if (miner) add('Miner attribution', miner, 'The mining pool associated with the confirming block.', 'Pool attribution is inferred from block information and does not necessarily identify the individual miner.');
  const hasWitness = tx.vin?.some(input => Array.isArray(input.witness) && input.witness.length > 0);
  const signalsRbf = tx.vin?.some(input => typeof input.sequence === 'number' && input.sequence < 0xfffffffe);
  const features = [hasWitness ? 'SegWit witness data' : '', signalsRbf ? 'Signals replaceability (RBF)' : ''].filter(Boolean);
  if (features.length) add('Transaction features', features.join(' · '), 'Bitcoin transaction features detected from input data.', 'Witness data indicates SegWit-style serialization, but does not by itself establish that a transaction uses Taproot. An input sequence below 0xfffffffe signals opt-in replaceability under the original BIP125 rules; current node replacement policy can differ.');
  add('Transaction hex', 'Raw transaction', 'The encoded transaction data for advanced inspection.', 'The raw hexadecimal representation contains the serialized transaction, not a plain-English explanation. Use the original technical details below to access the raw-transaction link.');
  return rows;
}
