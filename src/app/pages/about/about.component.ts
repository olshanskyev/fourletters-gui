import { Component, ChangeDetectionStrategy, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';

import { version } from '../../../../package.json';

@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  styleUrls: ['../legal/legal.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
})
export class AboutComponent {
  protected readonly version = version;
}
