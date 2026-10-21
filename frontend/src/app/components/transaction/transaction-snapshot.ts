import type { Transaction } from '@interfaces/electrs.interface';

export interface SnapshotFact { label: string; value: string; meaning: string; details: string; secondary?: string; fiatSats?: number; }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const number = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Present only observed facts; outputs do not identify a recipient's payment. */
export function transactionSnapshot(tx: Transaction | undefined, tip?: number, firstSeen?: number, replaced = false, miner?: string, networkFeeFloor?: number, etaWait?: number): SnapshotFact[] {
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
  const rate = fee !== null && vsize !== null && vsize > 0 ? fee / vsize : null;
  const feeContext = !confirmed && !coinbase && rate !== null && finite(networkFeeFloor) && networkFeeFloor > 0
    ? rate >= networkFeeFloor
      ? ' At the latest observed network snapshot, this rate meets or exceeds the lower edge of the first projected block (' + number(networkFeeFloor, 2) + ' sat/vB), but inclusion is not guaranteed.'
      : ' At the latest observed network snapshot, this rate is below the lower edge of the first projected block (' + number(networkFeeFloor, 2) + ' sat/vB), so it may have to wait for demand to ease or benefit from related fees.'
    : !confirmed ? ' Current network fee comparisons are unavailable; the rate alone cannot predict a confirmation time.' : '';
  const blockTime = tx.status?.block_time;
  const observedWait = confirmed && finite(firstSeen) && firstSeen > 0 && finite(blockTime) && blockTime >= firstSeen
    ? ' The provider first observed it about ' + number(Math.round((blockTime - firstSeen) / 60)) + ' minutes before the block timestamp; this is an approximate observation-based interval, not a guaranteed broadcast-to-confirmation duration.'
    : '';
  const now = Date.now() / 1000;
  const elapsed = finite(time) && time > 0 && time <= now ? Math.floor((now - time) / 60) : null;
  const age = elapsed === null ? undefined : elapsed < 1 ? 'Less than a minute ago' : elapsed < 60 ? number(elapsed) + ' minutes ago' : elapsed < 1440 ? number(Math.floor(elapsed / 60)) + ' hours ago' : number(Math.floor(elapsed / 1440)) + ' days ago';
  const total = tx.vout?.every(output => finite(output.value)) ? tx.vout.reduce((sum, output) => sum + output.value, 0) : null;
  const rows: SnapshotFact[] = [
    { label: 'Status', value: replaced && !confirmed ? 'Replaced' : confirmed ? 'Confirmed' : 'Pending', meaning: replaced && !confirmed ? 'A replacement transaction was observed. Follow the replacement link above for its current status.' : confirmed ? 'Recorded in a Bitcoin block.' : 'This transaction has not been confirmed. Inclusion and timing are not guaranteed.' },
    { label: 'Confirmations', value: confirmations === null ? (confirmed ? 'Checking latest block…' : '0') : number(confirmations), meaning: confirmed ? 'The containing block counts as the first confirmation. Each later block adds another.' : 'Confirmations begin when a miner includes this transaction in a block.' },
    { label: confirmed ? 'Confirmed at' : 'First seen', value: finite(time) && time > 0 && time < 8.64e12 ? new Date(time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not available', secondary: age, meaning: confirmed ? 'The time reported by the confirming block.' : 'When the observing provider first saw this transaction. Other nodes may report a different time.' },
    { label: 'Network fee', fiatSats: !coinbase && fee !== null ? fee : undefined, value: coinbase ? 'Not applicable' : fee === null ? 'Not available' : number(fee) + ' sats', meaning: coinbase ? 'This is a mining reward transaction; it does not pay a normal transaction fee.' : 'Paid to miners for this transaction, separate from its outputs.' },
    { label: 'Fee rate', value: coinbase ? 'Not applicable' : fee !== null && vsize !== null ? number(fee / vsize, 2) + ' sat/vB' : 'Not available', meaning: coinbase ? 'Mining reward transactions do not pay a normal fee.' : confirmed ? 'Fee paid per virtual byte of block space.' : 'Compared with the current queue; timing can change.' },
    { label: 'Included in block', value: confirmed ? (finite(height) ? '#' + number(height) : 'Checking block…') : 'Not yet confirmed', meaning: confirmed ? 'The Bitcoin block that recorded this transaction. The blocks above show its position.' : 'This transaction has not yet been included in a Bitcoin block.' },
    { label: 'Total output', value: total === null ? 'Not available' : number(total / 100000000, 8) + ' BTC', fiatSats: total ?? undefined, meaning: 'Combined output value; may include change returned to the sender.', details: 'This is the sum of every output, not necessarily the amount paid to another person. Without wallet context, the public record does not reliably identify your payment or change.' },
    { label: 'Inputs / outputs', value: number(tx.vin?.length ?? 0) + ' / ' + number(tx.vout?.length ?? 0), meaning: coinbase ? 'This transaction creates the mining reward. Outputs show how that reward was distributed.' : 'Previous outputs spent / new outputs created.' },
  ].map(row => ({ ...row, details: row.details || deeper[row.label] + (row.label === 'Fee rate' ? feeContext : row.label === 'Confirmed at' ? observedWait : '') }));
  if (!confirmed) {
    rows[1] = { label: 'Estimated confirmation', value: replaced ? 'Not applicable' : finite(etaWait) && etaWait >= 0 ? 'About ' + number(Math.max(1, Math.ceil(etaWait / 60000))) + ' minutes' : 'Unable to estimate', meaning: replaced ? 'Follow the replacement transaction for tracking.' : 'An estimate based on the current queue, not a countdown.', details: 'New transactions, miner choices and irregular block times can change this estimate. It is not a guaranteed inclusion time.' };
    const waiting = rows.findIndex(row => row.label === 'Included in block');
    rows[waiting] = { label: 'Waiting', value: replaced ? 'Replaced' : age ? age.replace(' ago', '') : 'Not available', meaning: 'Elapsed time since this provider first observed the transaction.', details: deeper['First seen'] };
  }
  const order = confirmed ? ['Status','Confirmations','Confirmed at','Included in block','Network fee','Fee rate','Total output','Inputs / outputs'] : ['Status','Estimated confirmation','First seen','Waiting','Network fee','Fee rate','Total output','Inputs / outputs'];
  return rows.sort((a,b) => order.indexOf(a.label) - order.indexOf(b.label));
}

export function transactionSummary(tx: Transaction | undefined, replaced = false): string {
  if (!tx) return 'Connecting to the Bitcoin transaction data…';
  if (replaced && !tx.status?.confirmed) return 'A replacement was observed for this transaction. Review the replacement link above before relying on its status.';
  if (tx.vin?.some(input => input.is_coinbase)) return 'This is a mining reward transaction. It creates the block subsidy and collects the block’s transaction fees.';
  return tx.status?.confirmed ? (finite(tx.status.block_height) ? 'Your transaction is included in block ' + number(tx.status.block_height) + '.' : 'Your transaction is confirmed.') + ' Review its confirmation status, network fee and recorded details below.' : 'Your transaction has not been confirmed yet. Its fee rate and competing network demand influence when it may be included; a confirmation time cannot be guaranteed.';
}

/** Additional protocol fields, deliberately separate from the quick snapshot. */
export function transactionTechnicalFacts(tx: Transaction | undefined, miner?: string, firstSeen?: number): SnapshotFact[] {
  if (!tx) return [];
  const rows: SnapshotFact[] = [];
  const add = (label: string, value: string, meaning: string, details: string) => rows.push({label, value, meaning, details});
  if (finite(tx.size)) add('Size', number(tx.size) + ' B', 'This transaction contains ' + number(tx.size) + ' bytes of serialized data. Its size tells you how much information is being sent, while its virtual size is more important for estimating Bitcoin network fees.', 'Size measures the serialized transaction data, including witness information when present. Bitcoin block capacity is accounted for using weight, rather than raw bytes alone.');
  if (finite(tx.weight)) {
    add('Virtual size', number(tx.weight / 4, 2) + ' vB', 'This transaction uses ' + number(tx.weight / 4, 2) + ' virtual bytes of block space. Wallets and miners use virtual size to compare transaction fees fairly, especially when SegWit witness data is involved.', 'Virtual size equals transaction weight divided by four. Some wallet and fee calculations round this up to the next whole virtual byte.');
    add('Adjusted vsize', number(tx.weight / 4, 2) + ' vB', 'This shows ' + number(tx.weight / 4, 2) + ' virtual bytes calculated from transaction weight. Some node policies apply extra minimum-size rules for signature operations, so an adjusted policy size may differ.', 'This displays the weight-derived virtual size. The upstream explorer can show a different adjusted value for transactions with special signature-operation costs, so it should not be interpreted as a separately verified policy-adjusted measurement.');
    add('Weight', number(tx.weight) + ' WU', 'This transaction has a weight of ' + number(tx.weight) + ' units. Weight measures its contribution to a block’s capacity, giving witness data a discount compared with other transaction data.', 'Witness data is discounted under SegWit weight rules. Weight determines how much of a block’s permitted capacity a transaction consumes.');
  }
  if (finite(tx.version)) add('Version', number(tx.version), 'Version ' + number(tx.version) + ' is a protocol field that tells Bitcoin software which transaction rules may apply. It is not a quality score, confirmation status, or indication of who sent the funds.', 'The version field helps signal how the transaction should be interpreted under Bitcoin consensus rules. It does not identify a wallet or exchange.');
  if (finite(tx.locktime)) add('Locktime', number(tx.locktime), tx.locktime === 0 ? 'This transaction has no absolute locktime restriction. That means this field does not delay its eligibility for inclusion in a Bitcoin block.' : 'This transaction specifies a locktime of ' + number(tx.locktime) + '. Depending on its input sequences, this can prevent it from being confirmed before a certain block height or time.', 'A nonzero locktime may restrict when a transaction can be included, depending on input sequence values. Values below 500 million are interpreted as block heights; larger values are Unix timestamps.');
  if (finite(tx.sigops)) add('Sigops', number(tx.sigops), 'This transaction is attributed ' + number(tx.sigops) + ' signature-checking operations. These checks help Bitcoin validate spending authorization and can affect resource limits or policy-adjusted size.', 'Signature operations are a Bitcoin validation resource. Their accounting can affect policy-adjusted virtual size and transaction acceptance.');
  if (tx.status?.confirmed && finite(tx.status.block_time)) add('Block timestamp', new Date(tx.status.block_time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC'), 'This is the time reported by the block that confirmed the transaction. It is useful for understanding when the payment entered the blockchain, but it may differ from when the sender first broadcast it.', 'A block timestamp is chosen by the miner within Bitcoin consensus limits. It is not necessarily the precise moment the payment was sent or first broadcast.');
  if (miner) add('Miner attribution', miner, 'The confirming block is attributed to ' + miner + '. This identifies the pool associated with mining the block, not the person who sent the payment or the individual mining machine.', 'Pool attribution is inferred from block information and does not necessarily identify the individual miner.');
  if (tx.status?.confirmed && finite(firstSeen) && firstSeen > 0 && finite(tx.status.block_time) && tx.status.block_time >= firstSeen) add('Observed confirmation duration', number(Math.round((tx.status.block_time - firstSeen) / 60)) + ' minutes', 'Approximate time from provider observation to block timestamp.', 'Provider first-seen time is not a universal broadcast time, and block timestamps are miner supplied.');
  const hasWitness = tx.vin?.some(input => Array.isArray(input.witness) && input.witness.length > 0);
  const signalsRbf = tx.vin?.some(input => typeof input.sequence === 'number' && input.sequence < 0xfffffffe);
  const features = [hasWitness ? 'SegWit witness data' : '', signalsRbf ? 'Signals replaceability (RBF)' : ''].filter(Boolean);
  if (!tx.status?.confirmed && !tx.vin?.some(input => input.is_coinbase)) add('Fee replacement', signalsRbf ? 'RBF signaled' : 'No opt-in RBF signal', 'Fee increases depend on wallet support, control of the inputs and node policy.', 'Opt-in signaling does not guarantee a replacement will be accepted. Some nodes use full-RBF policy. A recipient cannot assume they can replace the sender’s transaction.');
  if (features.length) add('Transaction features', features.join(' · '), 'The transaction input data indicates ' + features.join(' and ') + '. These features describe how the transaction is structured or may be replaced before confirmation; they do not reveal the recipient’s identity.', 'Witness data indicates SegWit-style serialization, but does not by itself establish that a transaction uses Taproot. An input sequence below 0xfffffffe signals opt-in replaceability under the original BIP125 rules; current node replacement policy can differ.');
  add('Transaction hex', 'Raw transaction', 'This is the complete transaction encoded as hexadecimal data. It is mainly useful for developers, wallets, and advanced users who need to inspect or independently verify the exact transaction bytes.', 'Raw transaction hex represents the exact serialized bytes that Bitcoin nodes process. It can be decoded into fields such as version, inputs, outputs, witness data and locktime. It is not encrypted and should not be confused with a private key. Open the raw hex link in Advanced Technical Tools if you need to inspect it.');
  return rows;
}
