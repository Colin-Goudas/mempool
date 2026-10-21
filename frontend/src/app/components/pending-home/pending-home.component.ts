import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';

@Component({
  selector: 'app-pending-home',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  templateUrl: './pending-home.component.html',
  styleUrls: ['./pending-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingHomeComponent {
  mode: 'transaction' | 'wallet' = 'transaction';
  preview: 'transaction' | 'wallet' = 'transaction';
  readonly transaction = '00079568fd91c81ecb530a15225e8590f4bb9c0c37eb5b3160d6daf064352d08';
  readonly address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
}
