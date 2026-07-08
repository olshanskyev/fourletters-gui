import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

import { GoogleAuthService, VKAuthService } from '@core/services/authentication';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatInputModule, TranslateModule],
})
export class HomeComponent implements AfterViewInit {
  private readonly vkService = inject(VKAuthService);
  private readonly googleService = inject(GoogleAuthService);

  vkButtonContainer = viewChild<ElementRef>('vkButtonContainer');
  googleButtonContainer = viewChild<ElementRef>('googleButtonContainer');

  ngAfterViewInit(): void {
    if (this.vkButtonContainer()) {
      this.vkService.renderOneTap(this.vkButtonContainer()!, { width: 300 });
    }
    if (this.googleButtonContainer()) {
      this.googleService.renderOneTap(this.googleButtonContainer()!, { width: 300 });
    }
  }
}
