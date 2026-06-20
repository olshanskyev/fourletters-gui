import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { MessagesService } from '@core/services/messages/messages.service';
import { from, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Pipe({
  name: 'decryptMessage',
  standalone: true
})
export class DecryptMessagePipe implements PipeTransform {
  private messagesService = inject(MessagesService);

  transform(message: LocalMessage): Observable<string> {
    if (!message || !message.text) {
      return of('');
    }

    return from(this.messagesService.decryptFromAtRest(message.id, message.text)).pipe(
      catchError(e => {
        console.error('Failed to decrypt message in UI:', e);
        return of('**(Encrypted)**');
      })
    );
  }
}

