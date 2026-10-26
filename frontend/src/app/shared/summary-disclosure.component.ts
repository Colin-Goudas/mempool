import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-summary-disclosure',
  standalone: true,
  imports: [CommonModule],
  template: `<p #paragraph class="pt-summary-narrative pt-four-line-copy"><strong *ngIf="labelText" #label class="pt-summary-inline-label">{{ labelText }}</strong> <span #full class="pt-disclosure-full" [hidden]="!expanded && truncated"><ng-content></ng-content></span><span *ngIf="!expanded && truncated">{{ labelText ? ' ' + preview : preview }}</span><span #ending class="pt-disclosure-ending" *ngIf="truncated || alwaysShowAction"><span *ngIf="!expanded && truncated" aria-hidden="true">… </span><span *ngIf="!truncated" aria-hidden="true"> </span><button type="button" class="pt-summary-expand-toggle" [attr.aria-expanded]="popoverTarget ? null : expanded" [attr.popovertarget]="popoverTarget || null" [attr.aria-controls]="popoverTarget || null" (click)="toggle()">{{ expanded ? 'Show less' : moreLabel }} <span aria-hidden="true">{{ expanded ? '▴' : '▾' }}</span></button></span></p>`,
  styles: [`:host{display:block;min-width:0}.pt-disclosure-full[hidden]{display:none!important}.pt-disclosure-ending{white-space:nowrap}.pt-disclosure-ending:has(button[aria-expanded="true"]){margin-left:4px}`]
})
export class SummaryDisclosureComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() resetKey = '';
  @Input() maxLines = 4;
  @Input() labelText = 'In plain English —';
  @Input() moreLabel = 'Read more';
  @Input() popoverTarget = '';
  @Input() alwaysShowAction = false;
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
      document.fonts?.ready.then(() => this.schedule());
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
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const probe = paragraph.cloneNode(false) as HTMLElement;
    probe.removeAttribute('id');
    Object.assign(probe.style, {position:'absolute', visibility:'hidden', pointerEvents:'none', width:paragraph.clientWidth + 'px', height:'auto', maxHeight:'none', margin:'0', padding:'0', top:'0', left:'0'});
    if (this.label) probe.appendChild(this.label.nativeElement.cloneNode(true));
    const copy = document.createElement('span');
    const ending = document.createElement('span');
    ending.className = 'pt-disclosure-ending';
    ending.style.whiteSpace = 'nowrap';
    const button = document.createElement('button');
    button.className = 'pt-summary-expand-toggle';
    button.textContent = this.moreLabel + ' ▾';
    ending.append('… ', button);
    probe.append(' ', copy);
    paragraph.parentElement!.appendChild(probe);
    const fits = () => probe.getBoundingClientRect().height <= lineHeight * this.maxLines + 0.5;
    copy.textContent = text;
    if (this.alwaysShowAction) probe.appendChild(ending);
    let truncated = !fits();
    let preview = text;
    if (truncated) {
      probe.appendChild(ending);
      const words = text.split(' ');
      let low = 0, high = words.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        copy.textContent = words.slice(0, mid).join(' ').replace(/[.,;:!?]+$/, '');
        if (fits()) low = mid; else high = mid - 1;
      }
      preview = words.slice(0, low).join(' ').replace(/[.,;:!?]+$/, '');
    }
    probe.remove();
    if (preview !== this.preview || truncated !== this.truncated) {
      this.zone.run(() => { this.preview = preview; this.truncated = truncated; this.cd.detectChanges(); });
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.resize?.disconnect();
    this.mutation?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
