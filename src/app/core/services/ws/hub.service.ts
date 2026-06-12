import { Injectable, OnDestroy, inject } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../authentication/auth.service';
import { EncryptedMessage } from '../../dto/encryptedMessage';

import { AckMessagePayload, AckMessagePayloadActionEnum, ReceiveMessagePayload, SendMessagePayload, SendMessagePayloadActionEnum } from '../../dto/models';

export type HubMessage = ReceiveMessagePayload | SendMessagePayload | AckMessagePayload;

@Injectable({
  providedIn: 'root'
})
export class HubService implements OnDestroy {
  private authService = inject(AuthService);
  private socket$?: WebSocketSubject<HubMessage>;
  private readonly messagesSubject = new Subject<EncryptedMessage>();

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

    this.socket$ = webSocket<HubMessage>(url);

    this.socket$.subscribe({
      next: (message) => {
        if ('event' in message && message.event === 'messageReceived') {
          this.messagesSubject.next(message.data);
        }
      },
      error: (err) => console.error('Hub WebSocket error:', err),
      complete: () => console.warn('Hub WebSocket connection closed')
    });
  }

  public get messages(): Observable<EncryptedMessage> {
    return this.messagesSubject.asObservable();
  }

  public sendMessage(recipientId: string, plainTextPayload: string): void {
    if (!this.socket$) {
      console.warn('Cannot send message: Hub WebSocket is not connected');
      return;
    }

    // TODO: Delegate to a proper CryptoService for E2E encryption
    const encryptedPayload = plainTextPayload;

    const message: EncryptedMessage = {
      messageId: crypto.randomUUID(),
      recipientId: recipientId,
      payload: encryptedPayload
    };

    this.socket$.next({
      action: SendMessagePayloadActionEnum.SendMessage,
      data: message
    } as SendMessagePayload);
  }

  public ackMessage(messageId: string): void {
    if (this.socket$) {
      this.socket$.next({
        action: AckMessagePayloadActionEnum.AckMessage,
        data: { messageId }
      } as AckMessagePayload);
    } else {
      console.warn('Cannot ack message: Hub WebSocket is not connected');
    }
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
