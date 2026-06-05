import { Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-default-layout',
  templateUrl: './default-layout.component.html',
  styleUrls: ['./default-layout.component.scss'],
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet],
})
export class DefaultLayoutComponent {}
