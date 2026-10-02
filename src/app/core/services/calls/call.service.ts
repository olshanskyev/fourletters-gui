import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, lastValueFrom } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { MessageHint } from '@dto/models';
import { AuthService } from '@core/services/authentication/auth.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { PushService } from '@core/services/push/push.service';
import { MessagesApiService } from '@core/services/messages/messages-api.service';
import { SecureMessageService } from '@core/services/messages/secure-message.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { CallHistoryService } from './call-history.service';
import { CallPeer } from './call-peer';
import { CallFailureReason, describeError, logCallFailure } from './call-telemetry';
import { IceServersService } from './ice-servers.service';
import { LocalMediaService } from './local-media.service';
import { ActiveCall, CallMedia, CallOutcome, CallSignal } from './models/call.model';

/** Emitted once per finished call, so the UI can react (e.g. explain a failure). */
export interface CallEnded {
  call: ActiveCall;
  outcome: CallOutcome;
  error?: unknown; // why a 'failed' call could not be set up locally (e.g. camera in use)
}

interface FinishOptions {
  notify?: 'hangup' | 'decline';
  error?: unknown;
  reason?: CallFailureReason;
}

/** Callee: the received offer and its early ICE candidates, held until the user answers. */
interface PendingOffer {
  sdp: string;
  candidates: RTCIceCandidateInit[];
}

/**
 * 1:1 audio/video calls over WebRTC. Media flows peer-to-peer (DTLS-SRTP); this service only
 * exchanges the E2E-encrypted signals that set a call up: the offer over the message path (so it
 * can wake an offline callee), everything after it over the Hub's ephemeral call_signal frame.
 */
@Injectable({
  providedIn: 'root'
})
export class CallService {
  /** The callee ignores an offer older than this; the caller rings for the same time. */
  static readonly OFFER_TTL_MS = 60_000;
  /** How long an answered call may take to establish media before it counts as failed. */
  static readonly CONNECT_TIMEOUT_MS = 30_000;

  private auth = inject(AuthService);
  private conversations = inject(ConversationsService);
  private push = inject(PushService);
  private messagesApi = inject(MessagesApiService);
  private secureMsg = inject(SecureMessageService);
  private hub = inject(HubService);
  private iceServers = inject(IceServersService);
  private translate = inject(TranslateService);
  private media = inject(LocalMediaService);
  private history = inject(CallHistoryService);

  readonly activeCall = signal<ActiveCall | null>(null);
  readonly remoteStream = signal<MediaStream | null>(null);
  /** Tracks are added to the same remote stream object, so its video presence is tracked here. */
  readonly remoteHasVideo = signal(false);

  private readonly endedSubject = new Subject<CallEnded>();
  readonly ended: Observable<CallEnded> = this.endedSubject.asObservable();

  private peer?: CallPeer;
  private timer?: ReturnType<typeof setTimeout>;
  private remoteOffer?: PendingOffer;
  /** Caller: the sent offer, kept for one re-keyed resend after an undecryptable NACK. */
  private sentOffer?: { signal: CallSignal; ts: number; rekeyed: boolean };

  /** Offers already handled, so an inbox redelivery never rings twice. */
  private readonly handledCallIds = new Set<string>();
  /** Message ids of the offers this device sent; their receipts are not chat receipts. */
  private readonly sentOfferIds = new Set<string>();

  // --- Outgoing -----------------------------------------------------------------------

  /**
   * Call the peer of a direct conversation. Rejects only when local media cannot be opened (no call
   * exists yet); later failures end the call and are reported via {@link ended}.
   */
  async startCall(conversationId: string, media: CallMedia): Promise<void> {
    if (this.activeCall()) {
      return;
    }
    const convo = await this.conversations.getConversation(conversationId);
    if (convo?.kind !== 'direct' || !convo.peerId) {
      throw new Error('Calls are only possible in direct conversations');
    }
    const peerId = convo.peerId;
    const callId = crypto.randomUUID();
    let stream: MediaStream;
    try {
      stream = await this.media.open(media);
    } catch (err) {
      console.warn('Call media unavailable', JSON.stringify({ media, error: describeError(err) }));
      throw err;
    }
    if (this.activeCall()) {
      // A call came in while the permission prompt was open.
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.media.use(stream);
    this.activeCall.set({
      callId, peerId, conversationId, direction: 'outgoing', media, phase: 'outgoing',
      startedAt: Date.now()
    });

    try {
      const peer = await this.createPeer(callId, peerId, stream);
      const sdp = await peer.createOffer();
      if (!this.isCurrent(callId)) {
        return;
      }
      const signal: CallSignal = { callId, type: 'offer', media, sdp };
      this.sentOffer = { signal, ts: Date.now(), rekeyed: false };
      this.sentOfferIds.add(callId);
      await this.sendOffer(peerId, false);
      this.armTimer(CallService.OFFER_TTL_MS, () => this.finish('missed', { notify: 'hangup' }));
    } catch (err) {
      if (this.isCurrent(callId)) {
        await this.finish('failed', { error: err, reason: 'setup' });
      }
    }
  }

  /** Whether a receipt refers to a call offer this device sent (not to a chat message). */
  ownsOffer(messageId: string): boolean {
    return this.sentOfferIds.has(messageId);
  }

  /**
   * The callee could not decrypt our offer (its device keys changed): re-key and resend it once,
   * otherwise give up.
   */
  async onOfferUndecryptable(messageId: string, recipientId: string): Promise<void> {
    const call = this.activeCall();
    if (!call || call.callId !== messageId || call.peerId !== recipientId || !this.sentOffer) {
      return;
    }
    if (call.phase !== 'outgoing' || this.sentOffer.rekeyed) {
      await this.finish('failed', { notify: 'hangup', reason: 'undecryptable' });
      return;
    }
    this.sentOffer.rekeyed = true;
    try {
      await this.sendOffer(call.peerId, true);
    } catch (err) {
      await this.finish('failed', { error: err, reason: 'undecryptable' });
    }
  }

  private async sendOffer(peerId: string, forceNewSession: boolean): Promise<void> {
    const { signal, ts } = this.sentOffer!;
    const { payload } = await this.secureMsg.buildCallPayload(peerId, signal, ts, forceNewSession);
    await lastValueFrom(
      this.messagesApi.sendMessage(peerId, payload, signal.callId, undefined, MessageHint.Call)
    );
  }

  // --- Incoming -----------------------------------------------------------------------

  /**
   * Answer the ringing incoming call; `withVideo=false` answers a video call with audio only.
   * A failure ends the call and is reported via {@link ended}.
   */
  async acceptCall(withVideo = true): Promise<void> {
    const call = this.activeCall();
    const offer = this.remoteOffer;
    if (!call || call.phase !== 'incoming' || !offer) {
      return;
    }
    const { callId, peerId } = call;
    this.clearTimer();
    this.setPhase('connecting');
    void this.closeCallNotification();

    try {
      const media: CallMedia = call.media === 'video' && withVideo ? 'video' : 'audio';
      const stream = await this.media.open(media);
      if (!this.isCurrent(callId)) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.media.use(stream);
      const peer = await this.createPeer(callId, peerId, stream);
      peer.addRemoteCandidates(offer.candidates);
      const sdp = await peer.answer(offer.sdp);
      if (!this.isCurrent(callId)) {
        return;
      }
      await this.sendSignal(peerId, { callId, type: 'answer', sdp });
      peer.startSendingCandidates();
      this.armConnectTimeout();
    } catch (err) {
      if (this.isCurrent(callId)) {
        await this.finish('failed', { notify: 'hangup', error: err, reason: 'setup' });
      }
    }
  }

  /** Reject the ringing incoming call. */
  async declineCall(): Promise<void> {
    if (this.activeCall()?.phase === 'incoming') {
      await this.finish('declined', { notify: 'decline' });
    }
  }

  /** Cancel a ringing outgoing call, decline a ringing incoming one, or end an active one. */
  async hangup(): Promise<void> {
    const call = this.activeCall();
    if (!call) {
      return;
    }
    if (call.phase === 'incoming') {
      await this.declineCall();
    } else if (call.phase === 'outgoing' || call.phase === 'connecting') {
      await this.finish('cancelled', { notify: 'hangup' });
    } else {
      await this.finish('ended', { notify: 'hangup' });
    }
  }

  // --- Signals from the peer ----------------------------------------------------------

  /** Handle a decrypted call signal; `ts` is the sender's send time from inside the envelope. */
  async handleSignal(senderId: string, signal: CallSignal, ts?: number): Promise<void> {
    if (signal.type === 'offer') {
      await this.onOffer(senderId, signal, ts);
      return;
    }
    const call = this.activeCall();
    if (!call || call.callId !== signal.callId || call.peerId !== senderId) {
      return;
    }
    switch (signal.type) {
      case 'ringing':
        if (call.phase === 'outgoing') {
          this.peer?.startSendingCandidates();
        }
        break;
      case 'answer':
        await this.onAnswer(call, signal);
        break;
      case 'ice': {
        const candidates = signal.candidates ?? [];
        if (this.peer) {
          this.peer.addRemoteCandidates(candidates);
        } else {
          this.remoteOffer?.candidates.push(...candidates);
        }
        break;
      }
      case 'hangup':
        if (call.phase === 'connecting') {
          // Usually the peer's connection failed first.
          await this.finish('failed', { reason: 'peer-hangup' });
        } else {
          await this.finish(call.phase === 'connected' ? 'ended' : 'missed');
        }
        break;
      case 'decline':
        if (call.direction === 'outgoing') {
          await this.finish('declined');
        }
        break;
      case 'busy':
        if (call.phase === 'outgoing') {
          await this.finish('busy');
        }
        break;
    }
  }

  private async onOffer(senderId: string, signal: CallSignal, ts?: number): Promise<void> {
    const { callId, media, sdp } = signal;
    if (!sdp || !media || this.handledCallIds.has(callId)) {
      return;
    }
    this.handledCallIds.add(callId);
    const conversationId = await this.conversations.ensureDirectConversation(senderId);
    const sentAt = ts ?? Date.now();
    const age = Date.now() - sentAt;
    if (age > CallService.OFFER_TTL_MS) {
      await this.history.log(conversationId, senderId, callId, sentAt,
        { media, direction: 'incoming', outcome: 'missed' });
      return;
    }

    const current = this.activeCall();
    if (current) {
      // We called each other at the same moment: the lower callId wins on both sides.
      const crossedCalls = current.peerId === senderId && current.phase === 'outgoing';
      if (!crossedCalls) {
        void this.sendSignal(senderId, { callId, type: 'busy' });
        await this.history.log(conversationId, senderId, callId, sentAt,
          { media, direction: 'incoming', outcome: 'missed' });
        return;
      }
      if (current.callId < callId) {
        return; // Our call wins; the peer drops theirs.
      }
      this.cleanup(); // Their call wins: abandon ours silently and ring for theirs.
    }

    this.remoteOffer = { sdp, candidates: [] };
    this.activeCall.set({
      callId, peerId: senderId, conversationId, direction: 'incoming', media, phase: 'incoming',
      startedAt: sentAt
    });
    await this.sendSignal(senderId, { callId, type: 'ringing' });
    this.armTimer(CallService.OFFER_TTL_MS - age, () => this.finish('missed'));
    void this.notifyIncoming(conversationId, senderId);
  }

  private async onAnswer(call: ActiveCall, signal: CallSignal): Promise<void> {
    const peer = this.peer;
    if (call.phase !== 'outgoing' || !signal.sdp || !peer) {
      return;
    }
    this.clearTimer();
    this.setPhase('connecting');
    try {
      await peer.acceptAnswer(signal.sdp);
    } catch (err) {
      await this.finish('failed', { notify: 'hangup', error: err, reason: 'answer-rejected' });
      return;
    }
    // In case 'ringing' was lost: the answer also proves the callee listens.
    peer.startSendingCandidates();
    this.armConnectTimeout();
  }

  /** Flip between the front and back camera of the running call. */
  async switchCamera(): Promise<void> {
    const sender = this.peer?.videoSender;
    if (sender) {
      await this.media.switchCamera(sender);
    }
  }

  // --- Lifecycle ----------------------------------------------------------------------

  /** Drop any call without logging it (logout). */
  reset(): void {
    this.cleanup();
    this.handledCallIds.clear();
    this.sentOfferIds.clear();
  }

  /** End the current call: optionally tell the peer, release media, and write the call log. */
  private async finish(
    outcome: CallOutcome, { notify, error, reason }: FinishOptions = {}
  ): Promise<void> {
    const call = this.activeCall();
    if (!call) {
      return;
    }
    if (notify) {
      void this.sendSignal(call.peerId, { callId: call.callId, type: notify });
    }
    const durationSec = outcome === 'ended' && call.connectedAt
      ? Math.round((Date.now() - call.connectedAt) / 1000)
      : undefined;
    const ice = this.peer?.diagnostics();
    this.cleanup();
    void this.closeCallNotification();
    this.endedSubject.next({ call, outcome, error });
    if (outcome === 'failed') {
      logCallFailure(call, reason ?? 'setup', error, ice);
    }
    await this.history.log(call.conversationId, call.peerId, call.callId, call.startedAt,
      { media: call.media, direction: call.direction, outcome, durationSec });
  }

  private cleanup(): void {
    this.clearTimer();
    this.peer?.close();
    this.peer = undefined;
    this.media.release();
    this.remoteStream.set(null);
    this.remoteHasVideo.set(false);
    this.activeCall.set(null);
    this.remoteOffer = undefined;
    this.sentOffer = undefined;
  }

  /** Peer connection for the given call; throws if that call ended meanwhile. */
  private async createPeer(callId: string, peerId: string, stream: MediaStream): Promise<CallPeer> {
    const iceServers = await this.iceServers.getIceServers();
    if (!this.isCurrent(callId)) {
      throw new Error('Call ended during setup');
    }
    this.peer = new CallPeer(iceServers, stream, {
      candidates: candidates => void this.sendSignal(peerId, { callId, type: 'ice', candidates }),
      track: ({ streams, track }) => {
        this.remoteStream.set(streams[0] ?? new MediaStream([track]));
        if (track.kind === 'video') {
          this.remoteHasVideo.set(true);
        }
      },
      connected: () => {
        if (this.activeCall()?.phase === 'connecting') {
          this.clearTimer();
          this.activeCall.update(
            call => call && { ...call, phase: 'connected', connectedAt: Date.now() }
          );
        }
      },
      failed: () => void this.finish('failed', { notify: 'hangup', reason: 'ice-failed' })
    });
    return this.peer;
  }

  // --- Helpers ------------------------------------------------------------------------

  /** Encrypt a signal and relay it over the Hub; best-effort like every ephemeral frame. */
  private async sendSignal(peerId: string, signal: CallSignal): Promise<void> {
    try {
      const { payload } = await this.secureMsg.buildCallPayload(peerId, signal);
      this.hub.sendCallSignal(peerId, payload);
    } catch (err) {
      console.warn('Failed to send call signal', signal.type, err);
    }
  }

  private async notifyIncoming(conversationId: string, senderId: string): Promise<void> {
    const myId = this.auth.currentUser()?.id;
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden' || !myId) {
      return;
    }
    try {
      const view = await this.conversations.getConversationView(conversationId);
      await this.push.showIncomingCallNotification(
        myId, view?.title ?? '', this.translate.instant('call_incoming'),
        { senderId, conversationId }, view?.avatarUrl
      );
    } catch (err) {
      console.warn('Failed to show incoming call notification', err);
    }
  }

  private async closeCallNotification(): Promise<void> {
    const myId = this.auth.currentUser()?.id;
    if (myId) {
      await this.push.closeNotifications(PushService.callNotificationTag(myId));
    }
  }

  private isCurrent(callId: string): boolean {
    return this.activeCall()?.callId === callId;
  }

  private setPhase(phase: ActiveCall['phase']): void {
    this.activeCall.update(call => call && { ...call, phase });
  }

  private armTimer(ms: number, onExpire: () => Promise<void>): void {
    this.clearTimer();
    this.timer = setTimeout(() => void onExpire(), Math.max(0, ms));
  }

  private armConnectTimeout(): void {
    this.armTimer(CallService.CONNECT_TIMEOUT_MS,
      () => this.finish('failed', { notify: 'hangup', reason: 'connect-timeout' }));
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
