export type BlockTouchAxis = 'pending' | 'horizontal' | 'vertical';

// Small tap movements do not start a drag; the first deliberate direction wins.
export function blockTouchAxis(dx: number, dy: number, axis: BlockTouchAxis = 'pending'): BlockTouchAxis {
  if (axis !== 'pending') return axis;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'pending';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}
