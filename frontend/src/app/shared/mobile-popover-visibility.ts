/** Extra room below a popover includes its border and a small visual margin. */
export function mobilePopoverVisibleHeight(panel: HTMLElement, viewportHeight: number): number {
  const border = Math.max(0, panel.offsetHeight - panel.clientHeight);
  return Math.min(panel.scrollHeight + border + 16, 436, Math.max(120, viewportHeight - 220));
}

/** Keep an expanded question visible inside its existing mobile popover. */
export function revealMobileHelpAnswer(event: Event): void {
  const details = event.target as HTMLDetailsElement;
  if (typeof window === 'undefined' || window.innerWidth > 767.98 || !details.open) return;
  const panel = details.closest<HTMLElement>('[popover]');
  if (!panel || !panel.matches(':popover-open')) return;
  requestAnimationFrame(() => {
    if (!details.open || !panel.matches(':popover-open')) return;
    const panelRect = panel.getBoundingClientRect();
    const detailsRect = details.getBoundingClientRect();
    const inset = 12;
    const available = panel.clientHeight - inset * 2;
    // For an answer taller than the panel, show its beginning so it can be scrolled naturally.
    const delta = detailsRect.height > available
      ? detailsRect.top - panelRect.top - inset
      : Math.max(0, detailsRect.bottom - panelRect.bottom + inset);
    if (delta) panel.scrollBy({ top: delta, behavior: 'auto' });
  });
}
