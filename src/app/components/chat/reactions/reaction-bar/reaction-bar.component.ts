import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { REACTION_EMOJIS } from '@core/services/messages/models/reactions.model';

@Component({
  selector: 'app-reaction-bar',
  imports: [MatButtonModule, TranslateModule],
  templateUrl: './reaction-bar.component.html',
  styleUrl: './reaction-bar.component.scss',
})
export class ReactionBarComponent {
  readonly current = input<string>();
  readonly picked = output<string>();
  protected readonly emojis = REACTION_EMOJIS;
}
