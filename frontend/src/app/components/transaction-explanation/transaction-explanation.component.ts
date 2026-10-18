import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-transaction-explanation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="explanation" aria-labelledby="explanation-title">
      <div class="explanation-heading">
        <h2 id="explanation-title">Your transaction, explained</h2>
        <button type="button" class="btn btn-outline-info btn-sm" (click)="explain()" [disabled]="loading">
          {{ loading ? 'Reading transaction…' : explanation ? 'Refresh explanation' : 'Explain this transaction' }}
        </button>
      </div>
      <p *ngIf="!explanation && !error">A plain-English summary of the Bitcoin data below.</p>
      <p *ngIf="explanation" aria-live="polite">{{ explanation }}</p>
      <p *ngIf="error" role="alert">{{ error }}</p>
      <small *ngIf="explanation">{{ source === 'ai' ? 'AI explanation based on current Bitcoin data. Check the details below.' : 'Summary from verified transaction data.' }}</small>
    </section>
  `,
  styles: [`
    .explanation { margin: 1rem 0 1.5rem; padding: 1.25rem; border: 1px solid #d5a04c38; border-radius: 16px; background: linear-gradient(120deg, #d5a04c0c, transparent); }
    .explanation-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    h2 { font-size: 1.1rem; color: #e8b45b; margin: 0; }
    p { color: #d0d2d7; line-height: 1.65; margin: .8rem 0 0; }
    small { display: block; color: #939aa6; margin-top: .75rem; }
    @media (max-width: 575px) { .explanation { padding: 1rem; } .explanation-heading { gap: .75rem; } }
  `],
})
export class TransactionExplanationComponent implements OnChanges, OnDestroy {
  @Input() txid: string;
  @Input() confirmed: boolean;
  loading = false;
  explanation = '';
  error = '';
  source = '';
  private request?: Subscription;

  constructor(private http: HttpClient) {}

  ngOnChanges(): void {
    this.request?.unsubscribe();
    this.loading = false;
    this.explanation = '';
    this.error = '';
  }

  explain(): void {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.request = this.http.post<{ explanation: string; source: string }>('/api/explain', { txid: this.txid }).subscribe({
      next: response => { this.explanation = response.explanation; this.source = response.source; this.loading = false; },
      error: () => { this.error = 'The explanation is temporarily unavailable. Your transaction details remain below.'; this.loading = false; },
    });
  }

  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
