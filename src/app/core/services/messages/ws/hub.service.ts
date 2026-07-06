import { Injectable, OnDestroy, inject } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '../../authentication/auth.service';
import { EncryptedMessage, MessageEvent, MessageEventEventEnum, ReceiptEvent, ReceiptEventEventEnum, ReceiptData } from '@dto/models';

export type HubEvent = MessageEvent | ReceiptEvent;

@Injectable({
  providedIn: 'root'
})
export class HubService implements OnDestroy {
  private authService = inject(AuthService);
  private socket$?: WebSocketSubject<HubEvent>;

  private reconnectDelay = 5000;
  private reconnectTimeoutId?: any;
  private isIntentionallyDisconnected = false;

  private readonly messagesSubject = new Subject<EncryptedMessage>();
  private readonly messageDeliveredSubject = new Subject<ReceiptData>();
  private readonly messageReadSubject = new Subject<ReceiptData>();
  private readonly messageUndecryptableSubject = new Subject<ReceiptData>();

  public connect(): void {
    if (this.socket$ && !this.socket$.closed) {
      return;
    }

    this.isIntentionallyDisconnected = false;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = undefined;
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
            case ReceiptEventEventEnum.MessageUndecryptable:
              this.messageUndecryptableSubject.next(message.data as ReceiptData);
              break;
          }
        }
      },
      error: (err) => {
        console.error('Hub WebSocket error:', err);
        this.scheduleReconnect();
      },
      complete: () => {
        console.warn('Hub WebSocket connection closed');
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyDisconnected) {
      return;
    }
    
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }
    
    this.socket$ = undefined;
    
    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
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

  public get messageUndecryptable(): Observable<ReceiptData> {
    return this.messageUndecryptableSubject.asObservable();
  }


  public disconnect(): void {
    this.isIntentionallyDisconnected = true;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = undefined;
    }
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = undefined;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
