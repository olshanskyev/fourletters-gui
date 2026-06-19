import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocalMessage } from '../../core/services/messages/models/messages.model';
import { SecureMessageService } from '../../core/services/messages/secure-message.service';
import { from, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Pipe({
  name: 'decryptMessage',
  standalone: true
})
export class DecryptMessagePipe implements PipeTransform {
  private secureMsg = inject(SecureMessageService);

  transform(message: LocalMessage): Observable<string> {
    if (!message || !message.text) {
      return of('');
    }

    return from(this.secureMsg.decryptFromAtRest(message.id, message.text)).pipe(
      catchError(e => {
        console.error('Failed to decrypt message in UI:', e);
        return of('**(Encrypted)**');
      })
    );
  }
}
