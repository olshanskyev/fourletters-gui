import { IceDiagnostics } from './call-peer';
import { ActiveCall } from './models/call.model';

/** Why a call failed, e.g. 'ice-failed' hints at NAT / missing TURN. */
export type CallFailureReason =
  'setup' | 'undecryptable' | 'answer-rejected' | 'ice-failed' | 'connect-timeout'
  | 'peer-hangup';

/** Name and message of an error, safe to log (no stack, no payloads). */
export function describeError(err: unknown): { name?: string; message?: string } {
  const { name, message } = (err ?? {}) as { name?: string; message?: string };
  return { name, message };
}

/** One telemetry line per failed call: why, in which phase, and what ICE could gather. */
export function logCallFailure(
  call: ActiveCall, reason: CallFailureReason, error?: unknown, ice?: IceDiagnostics
): void {
  console.error('Call failed', JSON.stringify({
    reason,
    direction: call.direction,
    media: call.media,
    phase: call.phase,
    connectedSec: call.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : null,
    error: error ? describeError(error) : null,
    ...ice
  }));
}
