import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-transaction-explanation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="explanation" [class.embedded]="embedded" aria-label="Transaction summary">
      <div class="explanation-heading">
        <h2>{{ embedded ? 'IN PLAIN ENGLISH' : 'Your transaction, explained' }}</h2>
        <button type="button" class="btn btn-outline-info btn-sm" (click)="explain()" [disabled]="loading">
          {{ loading ? 'Reading transaction…' : explanation ? 'Refresh summary' : 'Explain this transaction' }}
        </button>
      </div>
      <p *ngIf="!explanation && !error">{{ fallbackSummary || 'A plain-English summary of the Bitcoin data below.' }}</p>
      <p *ngIf="explanation" aria-live="polite">{{ explanation }}</p>
      <p *ngIf="error && fallbackSummary">{{ fallbackSummary }}</p>
      <small *ngIf="error" role="status">{{ error }}</small>
      <small *ngIf="explanation">{{ source === 'ai' ? 'AI explanation based on current Bitcoin data. Check the details below.' : 'Summary from verified transaction data.' }}</small>
    </section>
  `,
  styles: [`
    .explanation { margin: 1rem 0 1.5rem; padding: 1.25rem; border: 1px solid #d5a04c38; border-radius: 16px; background: linear-gradient(120deg, #d5a04c0c, transparent); }
    .explanation-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    h2 { font-size: 1.1rem; color: #e8b45b; margin: 0; }
    p { color: #d0d2d7; line-height: 1.65; margin: .8rem 0 0; }
    small { display: block; color: #939aa6; margin-top: .75rem; }
    .embedded { margin: 0; padding: 0; border: 0; border-radius: 0; background: none; }
    .embedded h2 { font-size: .7rem; letter-spacing: .1em; font-weight: 600; }
    .embedded p { font-size: .95rem; line-height: 1.55; margin-top: .5rem; }
    .embedded small { font-size: .72rem; }
    .embedded .btn { font-size: .7rem; padding: .2rem .55rem; }
    @media (max-width: 575px) { .explanation { padding: 1rem; } .explanation-heading { gap: .75rem; } }
  `],
})
export class TransactionExplanationComponent implements OnChanges, OnDestroy {
  @Input() txid: string;
  @Input() confirmed: boolean;
  @Input() embedded = false;
  @Input() fallbackSummary = '';
  loading = false;
  explanation = '';
  error = '';
  source = '';
  private request?: Subscription;

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.txid && !changes.confirmed) return;
    this.request?.unsubscribe();
    this.loading = false;
    this.explanation = '';
    this.error = '';
    if (this.txid) this.explain();
  }

  explain(): void {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.request = this.http.post<{ explanation: string; source: string }>('/api/explain', { txid: this.txid }).subscribe({
      next: response => { this.explanation = response.explanation; this.source = response.source; this.loading = false; },
      error: () => { this.error = 'The extended summary is temporarily unavailable. The displayed Bitcoin facts remain available.'; this.loading = false; },
    });
  }

  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
