import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-summary-disclosure',
  standalone: true,
  imports: [CommonModule],
  template: `<p #paragraph class="pt-summary-narrative pt-four-line-copy"><strong *ngIf="labelText" #label class="pt-summary-inline-label">{{ labelText }}</strong> <span #full class="pt-disclosure-full" [hidden]="!expanded && truncated"><ng-content></ng-content></span><span *ngIf="!expanded && truncated">{{ labelText ? ' ' + preview : preview }}</span><span #ending class="pt-disclosure-ending" *ngIf="truncated || alwaysShowAction"><span *ngIf="!expanded && truncated" aria-hidden="true">… </span><span *ngIf="!truncated" aria-hidden="true">{{ ' ' }}</span><button type="button" class="pt-summary-expand-toggle" [attr.aria-expanded]="popoverTarget ? null : expanded" [attr.popovertarget]="popoverTarget || null" [attr.aria-controls]="popoverTarget || null" (click)="toggle()">{{ expanded ? 'Show less' : moreLabel }}<span aria-hidden="true" class="pt-chevron"></span></button></span></p>`,
  styles: [`:host{display:block;min-width:0}.pt-disclosure-full[hidden]{display:none!important}.pt-disclosure-ending{white-space:nowrap}.pt-disclosure-ending:has(button[aria-expanded="true"]){margin-left:4px}`]
})
export class SummaryDisclosureComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() resetKey = '';
  @Input() maxLines = 4;
  @Input() labelText = 'In plain English —';
  @Input() moreLabel = 'Read more';
  @Input() popoverTarget = '';
  @Input() alwaysShowAction = false;
  @Input() endAtSentence = false;
  @ViewChild('paragraph') paragraph!: ElementRef<HTMLElement>;
  @ViewChild('full') full!: ElementRef<HTMLElement>;
  @ViewChild('label') label!: ElementRef<HTMLElement>;
  expanded = false;
  truncated = true;
  preview = '';
  private resize?: ResizeObserver;
  private mutation?: MutationObserver;
  private frame = 0;
  private destroyed = false;
  private measurementKey = '';
  constructor(private zone: NgZone, private cd: ChangeDetectorRef) {}
  ngOnChanges(changes: SimpleChanges): void {
    if (changes.resetKey) this.expanded = false;
    this.schedule();
  }
  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.resize = new ResizeObserver(() => this.schedule());
      this.resize.observe(this.paragraph.nativeElement);
      this.mutation = new MutationObserver(() => this.schedule());
      this.mutation.observe(this.full.nativeElement, {subtree:true, childList:true, characterData:true});
      document.fonts?.ready.then(() => { this.measurementKey = ''; this.schedule(); });
    });
    this.schedule();
  }
  toggle(): void { if (!this.popoverTarget) this.expanded = !this.expanded; }
  private schedule(): void {
    if (this.destroyed || !this.paragraph || this.frame) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.measure(); });
    });
  }
  private measure(): void {
    if (this.destroyed) return;
    const paragraph = this.paragraph.nativeElement;
    const text = (this.full.nativeElement.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || !paragraph.clientWidth) return;
    const style = getComputedStyle(paragraph);
    const width = paragraph.getBoundingClientRect().width;
    // Snapshot summaries use three lines on mobile; deeper descriptions retain their own limits.
    const mobileSnapshot = typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches && this.labelText === 'In plain English —' && !this.popoverTarget;
    const effectiveLines = mobileSnapshot ? Math.min(this.maxLines, 3) : this.maxLines;
    const key = [this.resetKey, text, width, effectiveLines, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, this.maxLines, this.labelText, this.moreLabel, this.alwaysShowAction, this.endAtSentence].join('|');
    if (key === this.measurementKey) return;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const maxHeight = lineHeight * Math.max(1, effectiveLines) + 0.5;
    // Measure the actual rendered text and control, including scoped styles,
    // fractional widths and browser-specific font metrics. All trials happen
    // synchronously before paint; restore the user's expanded state afterward.
    this.zone.run(() => {
      const wasExpanded = this.expanded;
      this.expanded = false;
      this.truncated = false;
      this.preview = text;
      this.cd.detectChanges();
      const fits = () => paragraph.getBoundingClientRect().height <= maxHeight;
      if (!fits()) {
        this.truncated = true;
        const words = text.split(' ');
        const excerpt = (count: number) => words.slice(0, count).join(' ').replace(/[.,;:!?]+$/, '');
        let low = 0, high = words.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          this.preview = excerpt(mid);
          this.cd.detectChanges();
          if (fits()) low = mid; else high = mid - 1;
        }
        this.preview = excerpt(low);
        if (this.endAtSentence && low > 0) {
          // Prefer a complete sentence when it fits; retain the ordinary word
          // fallback when a first sentence is longer than the available space.
          const complete = words.slice(0, low).join(' ').match(/^([\s\S]*[.!?])(?:\s|$)/);
          if (complete) {
            this.preview = complete[1];
            this.cd.detectChanges();
            const ending = paragraph.querySelector<HTMLElement>('.pt-disclosure-ending');
            // Keep the action on the final allowed line. A complete sentence
            // ending on line one would leave the second line unused.
            if (ending && effectiveLines > 1 && ending.getBoundingClientRect().top < paragraph.getBoundingClientRect().top + lineHeight * (effectiveLines - 1) - 1) {
              this.preview = excerpt(low);
            }
          }
        }
        this.cd.detectChanges();
        // Verify the final rendered result rather than trusting a proxy layout.
        while (low > 0 && !fits()) {
          this.preview = excerpt(--low);
          this.cd.detectChanges();
        }
      }
      this.expanded = wasExpanded;
      this.measurementKey = key;
      this.cd.detectChanges();
    });
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.resize?.disconnect();
    this.mutation?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
