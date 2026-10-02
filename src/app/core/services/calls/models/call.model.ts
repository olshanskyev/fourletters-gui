export type CallMedia = 'audio' | 'video';

export type CallSignalType = 'offer' | 'ringing' | 'answer' | 'ice' | 'hangup' | 'decline' | 'busy';

/** A call signal, carried E2E-encrypted over the pairwise Double Ratchet. */
export interface CallSignal {
  callId: string;
  type: CallSignalType;
  media?: CallMedia; // offer only
  sdp?: string; // offer / answer
  candidates?: RTCIceCandidateInit[]; // ice only
}

export type CallDirection = 'outgoing' | 'incoming';

/** 'outgoing'/'incoming' = ringing; 'connecting' = answered, ICE in progress. */
export type CallPhase = 'outgoing' | 'incoming' | 'connecting' | 'connected';

/** How a call ended; 'missed' from the caller's side means the callee never answered. */
export type CallOutcome = 'missed' | 'declined' | 'cancelled' | 'busy' | 'failed' | 'ended';

export interface ActiveCall {
  callId: string;
  peerId: string;
  conversationId: string;
  direction: CallDirection;
  media: CallMedia;
  phase: CallPhase;
  startedAt: number;
  connectedAt?: number;
}
