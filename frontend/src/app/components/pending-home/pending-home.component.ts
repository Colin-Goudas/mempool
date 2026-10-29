import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MobileLookupComponent } from '@app/shared/mobile-lookup.component';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pending-home',
  standalone: true,
  imports: [RouterModule, MobileLookupComponent],
  templateUrl: './pending-home.component.html',
  styleUrls: ['./pending-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingHomeComponent {}
