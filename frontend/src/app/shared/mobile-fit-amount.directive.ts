import { AfterViewInit, Directive, ElementRef, Inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Fit long BTC values without changing the normal size of short values. */
@Directive({ selector: '[ptMobileFitAmount]', standalone: true })
export class MobileFitAmountDirective implements AfterViewInit, OnDestroy {
  private resize?: ResizeObserver;
  private mutations?: MutationObserver;
  private frame = 0;
  private readonly schedule = (): void => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.fit(); });
  };
  constructor(private readonly host: ElementRef<HTMLElement>, @Inject(PLATFORM_ID) private readonly platform: object) {}
  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platform)) return;
    const el = this.host.nativeElement;
    if (typeof ResizeObserver !== 'undefined') { this.resize = new ResizeObserver(this.schedule); this.resize.observe(el); }
    this.mutations = new MutationObserver(this.schedule);
    this.mutations.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', this.schedule);
    this.schedule();
  }
  ngOnDestroy(): void {
    this.resize?.disconnect(); this.mutations?.disconnect();
    if (isPlatformBrowser(this.platform)) window.removeEventListener('resize', this.schedule);
    if (this.frame) cancelAnimationFrame(this.frame);
  }
  private fit(): void {
    const el = this.host.nativeElement;
    const value = el.querySelector<HTMLElement>(':scope > strong');
    const label = el.querySelector<HTMLElement>(':scope > span');
    if (!value || !label || window.innerWidth > 767.98 || !value.innerText.includes('BTC')) {
      el.style.removeProperty('--pt-fitted-amount'); el.classList.remove('pt-amount-needs-wrap', 'pt-amount-fit'); return;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const computed = getComputedStyle(value);
    ctx.font = `400 16px ${computed.fontFamily}`;
    const text = value.innerText.replace(/\s*·.*/, '').trim();
    const natural = ctx.measureText(text).width;
    const rowWidth = el.clientWidth || el.parentElement?.clientWidth || 0;
    const available = Math.max(0, rowWidth - label.getBoundingClientRect().width - 20);
    const size = Math.min(16, Math.max(12, Math.floor((available / Math.max(1, natural)) * 160) / 10));
    el.classList.add('pt-amount-fit');
    el.style.setProperty('--pt-fitted-amount', `${size}px`);
    el.classList.toggle('pt-amount-needs-wrap', natural * size / 16 > available);
  }
}
