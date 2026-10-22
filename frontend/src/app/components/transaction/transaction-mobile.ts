// Mempool uses 767.98px and mode=status/details for its phone tracker.
export function mobileTransactionView(width: number, mode?: string): 'desktop' | 'status' | 'details' {
  if (width > 767.98) return 'desktop';
  return mode === 'details' ? 'details' : 'status';
}
export function mobileTrackerStage(hasTx: boolean, confirmed: boolean, replaced: boolean, cached: boolean, blocks?: number): 'waiting' | 'pending' | 'soon' | 'next' | 'confirmed' | 'replaced' {
  if (replaced) return 'replaced';
  if (confirmed) return 'confirmed';
  if (!hasTx || cached) return 'waiting';
  if (blocks === 0) return 'next';
  if (Number.isFinite(blocks) && blocks >= 0 && blocks < 3) return 'soon';
  return 'pending';
}
