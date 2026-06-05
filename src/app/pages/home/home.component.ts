import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';

import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    TranslateModule,
    MatCardModule,
    RouterLink
  ],

})
export class HomeComponent {
  authService = inject(AuthService);
}
