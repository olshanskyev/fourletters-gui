import { Injectable, OnDestroy, inject } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../authentication/auth.service';
import { EncryptedMessage } from '../../../dto/encryptedMessage';
import { MessageEvent, MessageEventEventEnum } from '../../../dto/messageEvent';
import { ReceiptEvent, ReceiptEventEventEnum } from '../../../dto/receiptEvent';
import { ReceiptData } from '../../../dto/receiptData';


export type HubEvent = MessageEvent | ReceiptEvent;

@Injectable({
  providedIn: 'root'
})
export class HubService implements OnDestroy {
  private authService = inject(AuthService);
  private socket$?: WebSocketSubject<HubEvent>;

  private readonly messagesSubject = new Subject<EncryptedMessage>();
  private readonly messageDeliveredSubject = new Subject<ReceiptData>();
  private readonly messageReadSubject = new Subject<ReceiptData>();

  public connect(): void {
    if (this.socket$ && !this.socket$.closed) {
      return;
    }

    const token = this.authService.tokenReader.getAccessToken();
    if (!token) {
      console.warn('Cannot connect to hub without a token');
      return;
    }

    const baseUrl = environment.baseUrlHub;
    const url = `${baseUrl}/ws?token=${encodeURIComponent(token)}`;

    this.socket$ = webSocket<HubEvent>(url);

    this.socket$.subscribe({
      next: (message) => {
        if ('event' in message) {
          switch (message.event) {
            case MessageEventEventEnum.MessageReceived:
              this.messagesSubject.next(message.data as EncryptedMessage);
              break;
            case ReceiptEventEventEnum.MessageDelivered:
              this.messageDeliveredSubject.next(message.data as ReceiptData);
              break;
            case ReceiptEventEventEnum.MessageRead:
              this.messageReadSubject.next(message.data as ReceiptData);
              break;
          }
        }
      },
      error: (err) => console.error('Hub WebSocket error:', err),
      complete: () => console.warn('Hub WebSocket connection closed')
    });
  }

  public get messages(): Observable<EncryptedMessage> {
    return this.messagesSubject.asObservable();
  }

  public get messageDelivered(): Observable<ReceiptData> {
    return this.messageDeliveredSubject.asObservable();
  }

  public get messageRead(): Observable<ReceiptData> {
    return this.messageReadSubject.asObservable();
  }


  public disconnect(): void {
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = undefined;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
