/** Callbacks of a {@link CallPeer}; none fire after it is detached. */
export interface CallPeerEvents {
  /** Local ICE candidates, batched, to be sent to the peer. */
  candidates(candidates: RTCIceCandidateInit[]): void;
  track(event: RTCTrackEvent): void;
  connected(): void;
  failed(): void;
}

/** ICE state and candidate types (never addresses): 'srflx' missing = STUN unreachable. */
export interface IceDiagnostics {
  stunConfigured: boolean;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  localCandidateTypes: string[];
  remoteCandidateTypes: string[];
}

/**
 * The RTCPeerConnection of one call. Local ICE candidates are held until the peer listens,
 * remote ones until the remote description is set.
 */
export class CallPeer {
  /** Local ICE candidates gathered within this window travel in one signal. */
  private static readonly ICE_BATCH_MS = 100;

  private readonly pc: RTCPeerConnection;
  private sendCandidates = false;
  private localCandidates: RTCIceCandidateInit[] = [];
  private remoteCandidates: RTCIceCandidateInit[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly iceServers: RTCIceServer[],
    stream: MediaStream,
    private readonly events: CallPeerEvents
  ) {
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = event => {
      if (event.candidate) {
        this.localCandidates.push(event.candidate.toJSON());
        this.scheduleFlush();
      }
    };
    pc.ontrack = event => this.events.track(event);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.events.connected();
      } else if (pc.connectionState === 'failed') {
        this.events.failed();
      }
    };
  }

  get videoSender(): RTCRtpSender | undefined {
    return this.pc.getSenders().find(sender => sender.track?.kind === 'video');
  }

  /** Caller: create and apply the offer. */
  async createOffer(): Promise<string | undefined> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer.sdp;
  }

  /** Callee: apply the peer's offer, then create and apply the answer. */
  async answer(offerSdp: string): Promise<string | undefined> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    this.applyRemoteCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer.sdp;
  }

  /** Caller: apply the peer's answer. */
  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.applyRemoteCandidates();
  }

  /** The peer listens now: hand out gathered and future local candidates. */
  startSendingCandidates(): void {
    this.sendCandidates = true;
    this.flushCandidates();
  }

  addRemoteCandidates(candidates: RTCIceCandidateInit[]): void {
    if (!this.pc.remoteDescription) {
      this.remoteCandidates.push(...candidates);
      return;
    }
    for (const candidate of candidates) {
      this.pc.addIceCandidate(candidate)
        .catch(err => console.warn('Ignoring unusable ICE candidate', err));
    }
  }

  async diagnostics(): Promise<IceDiagnostics> {
    const local = new Set<string>();
    const remote = new Set<string>();
    try {
      (await this.pc.getStats()).forEach(report => {
        if (report.type === 'local-candidate') local.add(report.candidateType);
        if (report.type === 'remote-candidate') remote.add(report.candidateType);
      });
    } catch {
      // Stats are best-effort diagnostics.
    }
    return {
      stunConfigured: this.iceServers.length > 0,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      localCandidateTypes: [...local],
      remoteCandidateTypes: [...remote]
    };
  }

  /** Stop all events; the connection stays open (e.g. to read {@link diagnostics}). */
  detach(): void {
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    clearTimeout(this.flushTimer);
  }

  close(): void {
    this.detach();
    this.pc.close();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushCandidates();
    }, CallPeer.ICE_BATCH_MS);
  }

  private flushCandidates(): void {
    if (!this.sendCandidates || this.localCandidates.length === 0) {
      return;
    }
    const candidates = this.localCandidates;
    this.localCandidates = [];
    this.events.candidates(candidates);
  }

  private applyRemoteCandidates(): void {
    const pending = this.remoteCandidates;
    this.remoteCandidates = [];
    this.addRemoteCandidates(pending);
  }
}
