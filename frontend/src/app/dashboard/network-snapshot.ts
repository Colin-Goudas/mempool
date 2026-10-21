import type { BlockExtended, DifficultyAdjustment } from '@interfaces/node-api.interface';
import type { MempoolInfo, Recommendedfees } from '@interfaces/websocket.interface';

export interface NetworkSnapshotRow { label: string; value: string; meaning: string; details: string; fiatSats?: number; }
export interface NetworkSnapshot { summary: string; rows: NetworkSnapshotRow[]; deeper: NetworkSnapshotRow[]; questions: {id: string; label: string; text: string}[]; reconnecting: boolean; updatedAt: string; exampleFee?: number; }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const fmt = (n: number, digits = 0) => finite(n) ? n.toLocaleString('en-US', {maximumFractionDigits: digits}) : 'Unavailable';

/** Observations and estimates stay distinct: congestion is not a network-health diagnosis. */
export function networkSnapshot(mempool: MempoolInfo | null, fees: Recommendedfees | null, blocks: BlockExtended[] | null, difficulty: DifficultyAdjustment | null, incoming: number | null, reconnecting: boolean, blockVSize: number, receivedAt: number, now: number): NetworkSnapshot {
  const missing = reconnecting ? 'Connecting…' : 'Unavailable';
  const validFee = (n: unknown): n is number => finite(n) && n >= 0;
  const fee = validFee(fees?.fastestFee) ? fees.fastestFee : null;
  const economy = validFee(fees?.economyFee) ? fees.economyFee : null;
  const hour = validFee(fees?.hourFee) ? fees.hourFee : null;
  const queue = finite(mempool?.bytes) ? mempool.bytes : null;
  const pending = finite(mempool?.size) ? mempool.size : null;
  const latest = blocks?.[0];
  const age = finite(latest?.timestamp) ? Math.max(0, Math.floor((now / 1000 - latest.timestamp) / 60)) : null;
  const competition = fee === null || hour === null ? missing : fee > hour * 1.5 ? 'Fast tier costs more' : 'Similar fee tiers';
  const example = fee === null ? undefined : Math.ceil(fee * 140);
  const row = (label: string, value: string, meaning: string, details: string, fiatSats?: number): NetworkSnapshotRow => ({label,value,meaning,details,fiatSats});
  const rows = [
    row('Fee conditions', competition, 'Compare the cost of faster and slower confirmation targets.', 'We compare the next-block recommendation with the six-block recommendation. “Fast tier costs more” means it exceeds the six-block rate by more than 50%; “Similar fee tiers” means it does not. This describes current fee competition, not Bitcoin security, uptime or a guaranteed waiting time.'),
    row('Next-block fee', fee === null ? missing : fmt(fee,2) + ' sat/vB', 'Recommended rate when targeting the next block.', 'This recommendation uses the provider’s current queue. Miners choose transactions, related package fees matter, and block times vary. It is an estimate, not a promise that a payment will confirm in the next block.'),
    row('Example payment fee', example === undefined ? missing : fmt(example) + ' sats', 'Illustration for a 140-vB payment at the next-block rate.', 'Example only: next-block fee rate × 140 virtual bytes, rounded up. Actual size depends on inputs, outputs and script types. This is not a measured network average or an exchange withdrawal fee. Fiat uses the current price.', example),
    row('Confirmation targets', fee === null ? missing : '1–6 blocks', 'Roughly 10–60 minutes at the long-term target interval.', 'The fee tiers target different positions in the queue: next block, around three blocks, and around six blocks. Ten minutes per block is a long-term target; an individual block can arrive much sooner or later. These are targets, not a universal send time or deadline.'),
    row('Awaiting confirmation', pending === null ? missing : fmt(pending), 'Unconfirmed transactions observed by this provider.', 'Each node keeps its own mempool. Counts differ with policy, connectivity and eviction. Transaction count alone does not determine congestion: sizes and fee rates also matter.'),
    row('Waiting data', queue === null ? missing : fmt(queue / 1000000,2) + ' vMB', 'Virtual block space occupied by the observed queue.', 'Virtual megabytes account for Bitcoin transaction weight. At a maximum of about one million virtual bytes per full block, this queue represents roughly ' + (queue === null || !blockVSize ? 'an unavailable number of' : fmt(Math.ceil(queue / blockVSize))) + ' full blocks of data before new arrivals. This is not your transaction’s ETA.'),
    row('Latest block', latest ? '#' + fmt(latest.height) : missing, 'The newest confirmed block received from the provider.', latest ? 'This block contains ' + fmt(latest.tx_count) + ' transactions. Its timestamp is miner supplied under Bitcoin consensus rules; each subsequent block adds a confirmation to earlier transactions.' : 'Blocks group validated transactions and link them into Bitcoin’s chain.'),
    row('Last block', age === null ? missing : age === 0 ? 'Less than a minute ago' : fmt(age) + (age === 1 ? ' minute ago' : ' minutes ago'), 'Elapsed time since the latest block’s reported timestamp.', 'A longer gap between blocks does not by itself establish a network outage. Mining is probabilistic. The displayed age uses the miner-reported timestamp and may differ from actual arrival time.')
  ];
  const deeper = [
    row('Economy fee', economy === null ? missing : fmt(economy,2) + ' sat/vB', 'A lower-priority recommendation when you can wait.', 'Economy has no fixed confirmation deadline. It can become uncompetitive if new demand arrives; check your wallet’s estimate and fee-increase options.'),
    row('Six-block fee', hour === null ? missing : fmt(hour,2) + ' sat/vB', 'Recommended rate for a target of roughly six blocks.', 'The hour label used by many wallets assumes the long-term ten-minute block interval. It is not a promise of confirmation within sixty minutes.'),
    row('Minimum node fee', finite(mempool?.mempoolminfee) ? fmt(mempool.mempoolminfee * 100000,2) + ' sat/vB' : missing, 'This provider’s current minimum mempool acceptance rate.', 'A node’s acceptance floor is not a recommended next-block fee. It may rise during memory pressure and differs between nodes.'),
    row('Incoming activity', finite(incoming) ? fmt(incoming,0) + ' vB/s' : missing, 'Recent virtual bytes arriving per second.', 'This measures data arrival, not the number of payments or people. The chart below shows its recent history. Roughly ' + fmt(blockVSize / 600) + ' vB/s corresponds to full blocks at a ten-minute interval; short bursts above this are possible.'),
    row('Node memory', finite(mempool?.usage) ? fmt(mempool.usage / 1000000,1) + ' MB' : missing, 'Memory used by this provider’s unconfirmed transaction pool.', 'Node memory includes overhead and differs from virtual block space. This is one provider’s resource usage, not all Bitcoin nodes combined.'),
    row('Memory limit', finite(mempool?.maxmempool) ? fmt(mempool.maxmempool / 1000000,0) + ' MB' : missing, 'Configured mempool memory limit at this provider.', 'Nodes can configure different limits. Under pressure they may evict lower-fee transactions; removal from one node does not prove universal cancellation.'),
    row('Difficulty projection', finite(difficulty?.difficultyChange) ? (difficulty.difficultyChange > 0 ? '+' : '') + fmt(difficulty.difficultyChange,2) + '%' : missing, 'Estimated mining-difficulty change at the next adjustment.', 'Bitcoin adjusts difficulty every 2,016 blocks. This forecast changes with the observed pace of mining; it is not a Bitcoin price forecast.'),
    row('Observed block interval', finite(difficulty?.timeAvg) && difficulty.timeAvg > 0 ? fmt(difficulty.timeAvg / 60000,1) + ' minutes' : missing, 'Average block interval in the current difficulty period.', 'This historical observation is distinct from a pending transaction’s expected wait. Blocks arrive irregularly, and confirmation also depends on fee competition.')
  ];
  let summary = pending === null ? 'Waiting for current Bitcoin network data.' : fmt(pending) + ' transactions are waiting in this provider’s queue' + (queue === null ? '.' : ', occupying ' + fmt(queue / 1000000,2) + ' vMB of block space.');
  if (fee !== null) summary += ' The next-block fee recommendation is ' + fmt(fee,2) + ' sat/vB' + (economy === null ? '.' : ', versus ' + fmt(economy,2) + ' sat/vB for economy priority.');
  summary += ' Fee tiers target different confirmation speeds; actual timing varies with mining and new demand.';
  if (mempool?.loaded === false) summary += ' The provider is still loading its queue, so counts may be incomplete.';
  if (reconnecting) summary = 'Connecting to the live Bitcoin feed. Any retained values may be out of date; current network conditions cannot yet be assessed.';
  return {summary, rows, deeper, reconnecting, exampleFee:example, updatedAt:receivedAt ? new Date(receivedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Waiting for data', questions:[
    {id:'busy',label:'How busy is Bitcoin?',text:'Use fee tiers, waiting data and incoming activity together. A large low-fee backlog can coexist with inexpensive fast payments. A mempool is one provider’s observed queue, not a single worldwide waiting list or a network-health score.'},
    {id:'fees',label:'What fee should I choose?',text:'Choose a target based on urgency, then use your wallet’s size estimate to calculate total cost. Next-block targets favor speed; economy favors cost if you can wait. The example shown assumes 140 virtual bytes, not your transaction’s actual size. No fee guarantees a specific block.'},
    {id:'timing',label:'How long could a payment take?',text:'Fee recommendations target blocks, not fixed deadlines. Bitcoin targets about ten minutes per block over the long term, but gaps vary. Your fee rate, related transactions and new arrivals influence the wait. Look up your transaction ID for its specific status and estimate.'},
    {id:'visuals',label:'What do the visuals show?',text:'The ribbon above separates projected blocks from mined blocks. The block map below shows transactions in the next projected block; its filters change which types are highlighted. Incoming activity shows data arriving over time. Select blocks and transactions to inspect the original Mempool detail views.'}
  ]};
}
