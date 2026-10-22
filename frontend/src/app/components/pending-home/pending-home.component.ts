import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pending-home',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './pending-home.component.html',
  styleUrls: ['./pending-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingHomeComponent {}
