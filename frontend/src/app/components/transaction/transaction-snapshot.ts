import type { Transaction } from '@interfaces/electrs.interface';

export interface SnapshotFact { label: string; value: string; meaning: string; }
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
  return [
    { label: 'Status', value: replaced && !confirmed ? 'Replaced' : confirmed ? 'Confirmed' : 'Unconfirmed', meaning: replaced && !confirmed ? 'A replacement transaction was observed. Follow the replacement link above for its current status.' : confirmed ? 'This transaction is included in a Bitcoin block.' : 'This transaction has not been confirmed. Inclusion and timing are not guaranteed.' },
    { label: 'Confirmations', value: confirmations === null ? (confirmed ? 'Checking latest block…' : '0') : number(confirmations), meaning: confirmed ? 'The containing block counts as the first confirmation. Each later block adds another.' : 'Confirmations begin when a miner includes this transaction in a block.' },
    { label: confirmed ? 'Confirmed at' : 'First seen', value: finite(time) && time > 0 && time < 8.64e12 ? new Date(time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not available', meaning: confirmed ? 'The timestamp reported by the block containing this transaction.' : 'When the observing provider first saw this transaction. Other nodes may report a different time.' },
    { label: 'Network fee', value: coinbase ? 'Not applicable' : fee === null ? 'Not available' : number(fee) + ' sats', meaning: coinbase ? 'This is a mining reward transaction; it does not pay a normal transaction fee.' : 'The fee paid to miners by the whole transaction, separate from its outputs.' },
    { label: 'Fee rate', value: coinbase ? 'Not applicable' : fee !== null && vsize !== null ? number(fee / vsize, 2) + ' sat/vB' : 'Not available', meaning: 'The transaction fee divided by its virtual size. Related transactions can change the effective package fee rate; see deeper details.' },
    ...(confirmed && finite(height) ? [{ label: 'Included in block', value: '#' + number(height), meaning: 'The Bitcoin block that recorded this transaction. The blocks above show its position.' }] : []),
    ...(confirmed ? [{ label: 'Mining pool', value: miner || 'Not identified', meaning: 'The pool identified as mining the containing block. Attribution may not identify every participant.' }] : []),
    { label: 'Inputs / outputs', value: number(tx.vin?.length ?? 0) + ' / ' + number(tx.vout?.length ?? 0), meaning: coinbase ? 'This transaction creates the mining reward. Outputs show how that reward was distributed.' : 'Inputs spend previous outputs. New outputs may include change, so their total is not necessarily the payment amount.' },
  ];
}

export function transactionSummary(tx: Transaction | undefined, replaced = false): string {
  if (!tx) return 'Connecting to the Bitcoin transaction data…';
  if (replaced && !tx.status?.confirmed) return 'A replacement was observed for this transaction. Review the replacement link above before relying on its status.';
  if (tx.vin?.some(input => input.is_coinbase)) return 'This is a mining reward transaction. It creates the block subsidy and collects the block’s transaction fees.';
  return tx.status?.confirmed ? (finite(tx.status.block_height) ? 'Your transaction is included in block ' + number(tx.status.block_height) + '.' : 'Your transaction is confirmed.') + ' Review its confirmation status, network fee and recorded details below.' : 'Your transaction has not been confirmed yet. Its fee rate and competing network demand influence when it may be included; a confirmation time cannot be guaranteed.';
}
