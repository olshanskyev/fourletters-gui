import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject, Subscription } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '../../authentication/auth.service';
import { EncryptedMessage, MessageEvent, MessageEventEventEnum, ReceiptEvent, ReceiptEventEventEnum, ReceiptData } from '@dto/models';

export type HubEvent = MessageEvent | ReceiptEvent;

/** Coarse hub connection state for the UI (e.g. a progress/status indicator). */
export type HubConnectionState = 'connecting' | 'connected' | 'disconnected';

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
  private pingTimeoutId?: any;
  /** True until connect() and again after disconnect(), so a wake event can't silently reconnect. */
  private stopped = true;
  /** Guards the async open path so a wake/reconnect can't start a second concurrent connect. */
  private opening = false;

  private static readonly RECONNECT_DELAY_MS = 5000;
  /** Collapse the online/pageshow/visibilitychange burst one resume fires into a single reopen. */
  private static readonly WAKE_DEBOUNCE_MS = 500;
  /** How long to wait for a pong before treating a resumed socket as a silently-dropped zombie. */
  private static readonly PING_TIMEOUT_MS = 1500;

  /** Coarse connection state a UI can bind to (progress bar, status chip). */
  readonly connectionState = signal<HubConnectionState>('disconnected');

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
    void this.openSocket();
  }

  /** (Re)open the socket, always discarding any previous one first so only one can exist. */
  private async openSocket(): Promise<void> {
    // The open path is async (it may await a token refresh), so guard against a wake or a
    // reconnect timer starting a second concurrent connect while the first is still in flight.
    if (this.opening) {
      return;
    }
    this.opening = true;
    try {
      this.clearReconnectTimer();
      this.clearWakeTimer();
      this.clearPingTimer();
      this.teardownSocket();

      this.connectionState.set('connecting');
      const token = await this.acquireValidToken();

      // disconnect() may have run while we awaited the refresh; don't resurrect the socket.
      if (this.stopped) {
        this.connectionState.set('disconnected');
        return;
      }
      if (!token) {
        console.warn('Cannot connect to hub without a valid token');
        this.connectionState.set('disconnected');
        this.scheduleReconnect();
        return;
      }
      const url = `${environment.baseUrlHub}/ws?token=${encodeURIComponent(token)}`;
      const socket$ = webSocket<HubEvent>({
        url,
        openObserver: {
          next: () => {
            this.connectionState.set('connected');
            this.connectedSubject.next();
          }
        }
      });
      this.socket$ = socket$;
      this.socketSubscription = socket$.subscribe({
        next: (message) => this.dispatch(message),
        error: () => this.scheduleReconnect(),
        complete: () => this.scheduleReconnect()
      });
    } finally {
      this.opening = false;
    }
  }

  /**
   * Return a currently-valid access token to open the socket with
   */
  private acquireValidToken(): Promise<string | undefined> {
    return this.authService.getFreshAccessToken();
  }

  private dispatch(message: HubEvent): void {
    // Application-level pong: answer to our resume-time liveness probe; proves the socket is alive.
    if ((message as { type?: string }).type === 'pong') {
      this.clearPingTimer();
      return;
    }
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
   * suspend a backgrounded tab and kill the socket without firing close/error, leaving a zombie.
   * Rather than blindly reopening (which forces a redundant inbox resync on every foreground), we
   * actively probe the existing socket first and only reopen when it fails to answer.
   */
  private onWake(): void {
    if (this.stopped) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    // A single resume fires several of these events back-to-back; wait out the burst and probe once.
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
      this.probeOrReopen();
    }, HubService.WAKE_DEBOUNCE_MS);
  }

  /**
   * Test whether the current socket is still alive: send an application-level ping and wait for the
   * Hub's pong.
   */
  private probeOrReopen(): void {
    // No socket, or already reconnecting: just (re)open.
    if (!this.socket$ || this.connectionState() === 'connecting') {
      void this.openSocket();
      return;
    }
    // A probe is already in flight; let it resolve.
    if (this.pingTimeoutId) {
      return;
    }
    this.pingTimeoutId = setTimeout(() => {
      this.pingTimeoutId = undefined;
      void this.openSocket();
    }, HubService.PING_TIMEOUT_MS);
    try {
      this.socket$.next({ type: 'ping' } as unknown as HubEvent);
    } catch {
      // Sending on an already-broken socket - reopen immediately.
      this.clearPingTimer();
      void this.openSocket();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimeoutId) {
      return;
    }
    this.clearPingTimer();
    this.connectionState.set('disconnected');
    this.teardownSocket();
    this.reconnectTimeoutId = setTimeout(() => void this.openSocket(), HubService.RECONNECT_DELAY_MS);
  }

  private clearWakeTimer(): void {
    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
      this.wakeTimeoutId = undefined;
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId);
      this.pingTimeoutId = undefined;
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
    this.clearPingTimer();
    this.teardownSocket();
    this.connectionState.set('disconnected');
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
