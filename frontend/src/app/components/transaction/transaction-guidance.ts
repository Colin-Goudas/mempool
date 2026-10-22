/** Guidance describes the public record, never ownership or a guarantee of payment. */
export function transactionNextStep(state: {confirmed:boolean; confirmations:number; coinbase:boolean; replaced:boolean; conflict:boolean; cached:boolean; connected:boolean}): string {
  if (state.replaced || state.conflict) return 'Open the linked replacement or conflicting transaction and check its receiving outputs.';
  if (state.cached && !state.confirmed) return 'This is a cached record. Verify current status before relying on it.';
  if (!state.connected) return 'Reconnect to refresh the status before making a decision.';
  if (state.coinbase) return state.confirmations < 100 ? 'Mining rewards need 100 confirmations before they can be spent.' : 'The mining-reward maturity threshold has been reached; spending still requires the correct keys.';
  if (state.confirmed) return 'If the deposit is not showing, check the receiving service’s confirmation requirements and the receiving address.';
  return 'You can wait. If timing matters, check fee-increase options in the sending wallet or contact the sending exchange.';
}

/** Count distinct observed replacement versions, excluding the history root. */
export function replacementHistoryCount(root: {tx?: {txid?: string}; replaces?: any[]} | null | undefined): number {
  if (!root) return 0;
  const seen = new Set<string>();
  const stack = [root];
  const visited = new Set<object>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    if (node.tx?.txid) seen.add(node.tx.txid);
    for (const child of node.replaces || []) stack.push(child);
  }
  return Math.max(0, seen.size - 1);
}
