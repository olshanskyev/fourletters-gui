import { Injectable, OnDestroy, inject } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '../../authentication/auth.service';
import { isMobile } from '@core/utils/device';
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
  /** Emits on every (re)connection, so listeners can re-sync missed inbox after a wake. */
  private readonly connectedSubject = new Subject<void>();

  // Bound once so the same reference can be removed on destroy.
  private readonly wakeHandler = () => this.onWake();

  constructor() {
    if (typeof window !== 'undefined') {
      // iOS/Android suspend backgrounded tabs and may kill the socket without firing close/error;
      // reconnect when the app returns to the foreground (or the network comes back).
      window.addEventListener('online', this.wakeHandler);
      window.addEventListener('pageshow', this.wakeHandler);
      document.addEventListener('visibilitychange', this.wakeHandler);
    }
  }

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

    this.socket$ = webSocket<HubEvent>({
      url,
      openObserver: {
        next: () => this.connectedSubject.next()
      }
    });

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

  /**
   * Re-establish the connection when the app becomes visible again. iOS/Android can suspend a
   * backgrounded tab and silently kill the socket without ever firing close/error, so a genuine
   * disconnect goes unnoticed. On mobile we therefore reconnect on any wake; on desktop we only
   * act when the socket already looks closed (a real close there fires scheduleReconnect anyway).
   */
  private onWake(): void {
    if (this.isIntentionallyDisconnected) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    const socketDead = !this.socket$ || this.socket$.closed;
    if (socketDead || isMobile) {
      this.forceReconnect();
    }
  }

  /** Tear down any existing socket (dead or zombie) and connect immediately. */
  private forceReconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = undefined;
    }
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = undefined;
    }
    this.connect();
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

  /** Emits whenever the socket (re)connects, e.g. after waking from background. */
  public get connected(): Observable<void> {
    return this.connectedSubject.asObservable();
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.wakeHandler);
      window.removeEventListener('pageshow', this.wakeHandler);
      document.removeEventListener('visibilitychange', this.wakeHandler);
    }
    this.disconnect();
  }
}
