import { Injectable, OnDestroy, inject } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject, Subscription } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '../../authentication/auth.service';
import { EncryptedMessage, MessageEvent, MessageEventEventEnum, ReceiptEvent, ReceiptEventEventEnum, ReceiptData } from '@dto/models';

export type HubEvent = MessageEvent | ReceiptEvent;

/**
 * Single live WebSocket to the Hub. The whole design rests on one invariant: every (re)connect
 * tears down the previous socket first, so at most one socket ever exists. That alone guarantees
 * "one connection per user" - no in-flight flags, no supersede handshake.
 */
@Injectable({
  providedIn: 'root'
})
export class HubService implements OnDestroy {
  private authService = inject(AuthService);
  private socket$?: WebSocketSubject<HubEvent>;
  private socketSubscription?: Subscription;
  private reconnectTimeoutId?: any;
  private wakeTimeoutId?: any;
  /** True until connect() and again after disconnect(), so a wake event can't silently reconnect. */
  private stopped = true;

  private static readonly RECONNECT_DELAY_MS = 5000;
  /** Collapse the online/pageshow/visibilitychange burst one resume fires into a single reopen. */
  private static readonly WAKE_DEBOUNCE_MS = 500;

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

  /** Open the connection (idempotent). Called once when the user is authenticated. */
  public connect(): void {
    this.stopped = false;
    this.openSocket();
  }

  /** (Re)open the socket, always discarding any previous one first so only one can exist. */
  private openSocket(): void {
    this.clearReconnectTimer();
    this.clearWakeTimer();
    this.teardownSocket();

    const token = this.authService.tokenReader.getAccessToken();
    if (!token) {
      console.warn('Cannot connect to hub without a token');
      return;
    }

    const url = `${environment.baseUrlHub}/ws?token=${encodeURIComponent(token)}`;
    const socket$ = webSocket<HubEvent>({
      url,
      openObserver: { next: () => this.connectedSubject.next() }
    });
    this.socket$ = socket$;
    this.socketSubscription = socket$.subscribe({
      next: (message) => this.dispatch(message),
      error: () => this.scheduleReconnect(),
      complete: () => this.scheduleReconnect()
    });
  }

  private dispatch(message: HubEvent): void {
    if (!('event' in message)) {
      return;
    }
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

  /**
   * Reconnect when the app returns to the foreground or the network comes back. iOS/Android can
   * suspend a backgrounded tab and kill the socket without firing close/error, leaving a zombie;
   * reopening (which first tears down the old socket) heals that in every case.
   */
  private onWake(): void {
    if (this.stopped) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    // A single resume fires several of these events back-to-back; wait out the burst and reopen once.
    if (this.wakeTimeoutId) {
      return;
    }
    this.wakeTimeoutId = setTimeout(() => {
      this.wakeTimeoutId = undefined;
      if (this.stopped) {
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      this.openSocket();
    }, HubService.WAKE_DEBOUNCE_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimeoutId) {
      return;
    }
    this.teardownSocket();
    this.reconnectTimeoutId = setTimeout(() => this.openSocket(), HubService.RECONNECT_DELAY_MS);
  }

  private clearWakeTimer(): void {
    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
      this.wakeTimeoutId = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = undefined;
    }
  }

  /** Unsubscribe and complete the current socket so its async callbacks can't drive state. */
  private teardownSocket(): void {
    this.socketSubscription?.unsubscribe();
    this.socketSubscription = undefined;
    this.socket$?.complete();
    this.socket$ = undefined;
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
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearWakeTimer();
    this.teardownSocket();
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
