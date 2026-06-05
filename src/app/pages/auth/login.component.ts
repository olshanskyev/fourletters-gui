import { Location } from '@angular/common';
import { AfterViewInit, Component, ElementRef, inject, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { MatIconModule } from '@angular/material/icon';
import { GoogleAuthService, VKAuthService } from '../../core/services';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  imports: [

    MatButtonModule,
    MatCardModule,
    MatInputModule,
    MatIconModule,
    TranslateModule
  ],
})
export class LoginComponent implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly vkService = inject(VKAuthService);
  private readonly googleService = inject(GoogleAuthService);

  vkButtonContainer = viewChild<ElementRef>('vkButtonContainer');
  googleButtonContainer = viewChild<ElementRef>('googleButtonContainer');


  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl('/');
    }
  }

  ngAfterViewInit(): void {
    if (this.vkButtonContainer()) {
      this.vkService.renderOneTap(this.vkButtonContainer()!, {width: 300});
    }
    if (this.googleButtonContainer()) {
      this.googleService.renderOneTap(this.googleButtonContainer()!, {width: 300});
    }
  }
}
