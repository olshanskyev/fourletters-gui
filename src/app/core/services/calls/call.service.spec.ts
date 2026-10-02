import { Injector } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { MessageHint } from '@dto/models';
import { AuthService } from '@core/services/authentication/auth.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { PushService } from '@core/services/push/push.service';
import { MessagesApiService } from '@core/services/messages/messages-api.service';
import { MessagesRepository } from '@core/services/messages/messages.repository';
import { SecureMessageService } from '@core/services/messages/secure-message.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { SystemMessage } from '@core/services/messages/models/messages.model';
import { CallService } from './call.service';
import { CallHistoryService } from './call-history.service';
import { IceServersService } from './ice-servers.service';
import { LocalMediaService } from './local-media.service';
import { CallSignal } from './models/call.model';

const PEER = 'peer-id';
const CONVERSATION = 'conversation-id';

interface FakeIceEvent { candidate: { toJSON(): RTCIceCandidateInit } | null }

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  onicecandidate: ((e: FakeIceEvent) => void) | null = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  addIceCandidate = vi.fn(async () => undefined);
  close = vi.fn();

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addTrack(): void {}
  getSenders(): RTCRtpSender[] { return []; }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' }; }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  emitCandidate(candidate: string): void {
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate }) } });
  }

  setState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), enabled: true, kind: 'audio' };
  return {
    track,
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => []
  };
}

describe('CallService', () => {
  let service: CallService;
  let hub: { sendCallSignal: ReturnType<typeof vi.fn> };
  let messagesApi: { sendMessage: ReturnType<typeof vi.fn> };
  let repository: { updateMessage: ReturnType<typeof vi.fn> };
  let push: Record<'closeNotifications' | 'showIncomingCallNotification', ReturnType<typeof vi.fn>>;
  let stream: ReturnType<typeof fakeStream>;

  /** Signals relayed over the Hub, decoded from the fake (plaintext) payloads. */
  const hubSignals = (): CallSignal[] =>
    hub.sendCallSignal.mock.calls.map(([, payload]) => JSON.parse(payload as string));

  const loggedCalls = (): SystemMessage[] =>
    repository.updateMessage.mock.calls.map(([message]) => message as SystemMessage);

  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    FakePeerConnection.instances = [];
    stream = fakeStream();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => stream),
        enumerateDevices: vi.fn(async () => [])
      }
    });

    hub = { sendCallSignal: vi.fn() };
    messagesApi = { sendMessage: vi.fn(() => of({})) };
    repository = { updateMessage: vi.fn(async () => undefined) };
    push = {
      closeNotifications: vi.fn(async () => undefined),
      showIncomingCallNotification: vi.fn(async () => undefined)
    };

    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me-id' }) } },
        {
          provide: ConversationsService,
          useValue: {
            getConversation: async () => ({ id: CONVERSATION, kind: 'direct', peerId: PEER }),
            ensureDirectConversation: async () => CONVERSATION,
            updateLastMessage: async () => undefined,
            getConversationView: async () => ({ title: 'Peer' })
          }
        },
        { provide: PushService, useValue: push },
        { provide: MessagesApiService, useValue: messagesApi },
        { provide: MessagesRepository, useValue: repository },
        {
          provide: SecureMessageService,
          useValue: {
            buildCallPayload: async (_peer: string, signal: CallSignal) =>
              ({ payload: JSON.stringify(signal) })
          }
        },
        { provide: HubService, useValue: hub },
        { provide: IceServersService, useValue: { getIceServers: async () => [] } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: LocalMediaService, useClass: LocalMediaService, deps: [] },
        { provide: CallHistoryService, useClass: CallHistoryService, deps: [] },
        { provide: CallService, useClass: CallService, deps: [] }
      ]
    });
    service = injector.get(CallService);
  });

  afterEach(() => {
    service.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function receiveOffer(callId = 'call-b', ts = Date.now()): Promise<void> {
    await service.handleSignal(PEER, { callId, type: 'offer', media: 'video', sdp: 'remote' }, ts);
  }

  describe('outgoing call', () => {
    it('sends the offer over the message path with the call hint', async () => {
      await service.startCall(CONVERSATION, 'audio');

      const call = service.activeCall()!;
      expect(call.phase).toBe('outgoing');
      const [recipient, payload, messageId, groupId, hint] = messagesApi.sendMessage.mock.calls[0];
      expect(recipient).toBe(PEER);
      expect(messageId).toBe(call.callId);
      expect(groupId).toBeUndefined();
      expect(hint).toBe(MessageHint.Call);
      expect(JSON.parse(payload)).toMatchObject({ type: 'offer', media: 'audio', sdp: 'offer-sdp' });
      expect(service.ownsOffer(call.callId)).toBe(true);
    });

    it('holds local ICE candidates until the callee rings', async () => {
      await service.startCall(CONVERSATION, 'audio');
      const { callId } = service.activeCall()!;
      FakePeerConnection.instances[0].emitCandidate('c1');
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(hubSignals()).toEqual([]);

      await service.handleSignal(PEER, { callId, type: 'ringing' });
      await flush();

      expect(hubSignals()).toEqual([{ callId, type: 'ice', candidates: [{ candidate: 'c1' }] }]);
    });

    it('connects on answer and logs the ended call with its duration', async () => {
      await service.startCall(CONVERSATION, 'audio');
      const { callId } = service.activeCall()!;
      const pc = FakePeerConnection.instances[0];

      await service.handleSignal(PEER, { callId, type: 'answer', sdp: 'answer-sdp' });
      expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });
      expect(service.activeCall()!.phase).toBe('connecting');

      pc.setState('connected');
      expect(service.activeCall()!.phase).toBe('connected');

      await service.hangup();
      await flush();
      expect(service.activeCall()).toBeNull();
      expect(stream.track.stop).toHaveBeenCalled();
      expect(pc.close).toHaveBeenCalled();
      expect(hubSignals()).toContainEqual({ callId, type: 'hangup' });
      expect(loggedCalls()[0].call).toMatchObject({ direction: 'outgoing', outcome: 'ended' });
      expect(loggedCalls()[0].call!.durationSec).toBeTypeOf('number');
    });

    it('logs a declined call', async () => {
      await service.startCall(CONVERSATION, 'video');
      const { callId } = service.activeCall()!;

      await service.handleSignal(PEER, { callId, type: 'decline' });

      expect(service.activeCall()).toBeNull();
      expect(loggedCalls()[0].call).toMatchObject({ media: 'video', outcome: 'declined' });
    });

    it('gives up after the ring timeout and tells the callee', async () => {
      vi.useFakeTimers();
      await service.startCall(CONVERSATION, 'audio');
      const { callId } = service.activeCall()!;

      await vi.advanceTimersByTimeAsync(CallService.OFFER_TTL_MS);

      expect(service.activeCall()).toBeNull();
      expect(hubSignals()).toContainEqual({ callId, type: 'hangup' });
      expect(loggedCalls()[0].call).toMatchObject({ direction: 'outgoing', outcome: 'missed' });
    });

    it('ignores signals for another call or from another sender', async () => {
      await service.startCall(CONVERSATION, 'audio');
      const { callId } = service.activeCall()!;

      await service.handleSignal(PEER, { callId: 'other', type: 'decline' });
      await service.handleSignal('someone-else', { callId, type: 'decline' });

      expect(service.activeCall()).not.toBeNull();
    });
  });

  describe('incoming call', () => {
    it('rings and tells the caller', async () => {
      await receiveOffer();

      expect(service.activeCall()).toMatchObject({
        callId: 'call-b', peerId: PEER, direction: 'incoming', phase: 'incoming', media: 'video'
      });
      expect(hubSignals()).toEqual([{ callId: 'call-b', type: 'ringing' }]);
    });

    it('logs a stale offer as missed without ringing', async () => {
      await receiveOffer('call-b', Date.now() - CallService.OFFER_TTL_MS - 1);

      expect(service.activeCall()).toBeNull();
      expect(hubSignals()).toEqual([]);
      expect(loggedCalls()[0].call).toMatchObject({ direction: 'incoming', outcome: 'missed' });
    });

    it('rings only once for a redelivered offer', async () => {
      await receiveOffer();
      await service.declineCall();
      await receiveOffer();

      expect(service.activeCall()).toBeNull();
    });

    it('answers with the local description and applies early remote candidates', async () => {
      await receiveOffer();
      await service.handleSignal(PEER, { callId: 'call-b', type: 'ice', candidates: [{ candidate: 'r1' }] });

      await service.acceptCall();

      const pc = FakePeerConnection.instances[0];
      expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'remote' });
      expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: 'r1' });
      expect(hubSignals()).toContainEqual({ callId: 'call-b', type: 'answer', sdp: 'answer-sdp' });
      expect(service.activeCall()!.phase).toBe('connecting');
      expect(push.closeNotifications).toHaveBeenCalledWith('fourletters-call-me-id');
    });

    it('ends a failed answer once, carrying the media error', async () => {
      const busy = Object.assign(new Error('Could not start video source'), { name: 'NotReadableError' });
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(busy);
      const ended: unknown[] = [];
      service.ended.subscribe(e => ended.push(e));
      await receiveOffer();

      await expect(service.acceptCall()).resolves.toBeUndefined();

      expect(ended).toEqual([expect.objectContaining({ outcome: 'failed', error: busy })]);
      expect(hubSignals()).toContainEqual({ callId: 'call-b', type: 'hangup' });
      expect(service.activeCall()).toBeNull();
    });

    it('logs a missed call when the caller hangs up while ringing', async () => {
      await receiveOffer();

      await service.handleSignal(PEER, { callId: 'call-b', type: 'hangup' });

      expect(service.activeCall()).toBeNull();
      expect(loggedCalls()[0].call).toMatchObject({ direction: 'incoming', outcome: 'missed' });
    });

    it('sends busy while another call is active', async () => {
      await receiveOffer('call-b');
      await service.handleSignal('third', { callId: 'call-c', type: 'offer', media: 'audio', sdp: 's' });

      expect(service.activeCall()!.callId).toBe('call-b');
      expect(hubSignals()).toContainEqual({ callId: 'call-c', type: 'busy' });
      expect(loggedCalls()[0].call).toMatchObject({ direction: 'incoming', outcome: 'missed' });
    });
  });

  describe('crossed calls (both call each other at once)', () => {
    it('keeps our call when its id is lower', async () => {
      await service.startCall(CONVERSATION, 'audio');
      const ours = service.activeCall()!.callId;

      await receiveOffer('~'.repeat(40));

      expect(service.activeCall()!.callId).toBe(ours);
    });

    it('switches to the peer call when its id is lower', async () => {
      await service.startCall(CONVERSATION, 'audio');

      await receiveOffer('0');

      expect(service.activeCall()).toMatchObject({ callId: '0', direction: 'incoming' });
      expect(loggedCalls()).toEqual([]);
    });
  });
});
