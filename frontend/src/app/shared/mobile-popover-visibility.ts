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
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[popovertarget]'))
      .find(button => button.getAttribute('popovertarget') === panel.id && button.getClientRects().length > 0 && button.getAttribute('popovertargetaction') !== 'hide');
    if (trigger) {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const anchor = trigger.closest('.pt-summary-actionbar, .pt-mobile-help-toolbar')?.getBoundingClientRect() || trigger.getBoundingClientRect();
      const desired = mobilePopoverVisibleHeight(panel, viewportHeight);
      const availableBelow = viewportHeight - 76 - anchor.bottom - 8;
      const shift = Math.min(Math.max(0, desired - availableBelow), Math.max(0, anchor.top - 120));
      if (shift) window.scrollBy({top: shift, behavior: 'auto'});
    }
    requestAnimationFrame(() => {
      if (!details.open || !panel.matches(':popover-open')) return;
      const panelRect = panel.getBoundingClientRect();
      const detailsRect = details.getBoundingClientRect();
      const inset = 12;
      const heading = panel.querySelector<HTMLElement>('.pt-mobile-help-heading, .pt-network-popup-heading, .pt-wallet-popup-heading');
      const topInset = inset + (heading?.offsetHeight || 0);
      const available = panel.clientHeight - topInset - inset;
      const delta = detailsRect.height > available
        ? detailsRect.top - panelRect.top - topInset
        : Math.max(0, detailsRect.bottom - panelRect.bottom + inset);
      if (delta) panel.scrollBy({ top: delta, behavior: 'auto' });
    });
  });
}
