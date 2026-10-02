import { CallLogEntry } from '@core/services/messages/models/messages.model';

/** i18n key explaining why a call could not start or be answered. */
export function callErrorKey(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'call_error_permission';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'call_error_no_device';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'call_error_device_busy';
  }
  return 'call_error_generic';
}

/** `m:ss`, or `h:mm:ss` for calls of an hour or longer. */
export function formatCallDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** i18n key of the call-log line shown in the chat timeline. */
export function callLogKey(entry: CallLogEntry): string {
  const incoming = entry.direction === 'incoming';
  switch (entry.outcome) {
    case 'missed':
      return incoming ? 'call_log_missed' : 'call_log_no_answer';
    case 'declined':
      return incoming ? 'call_log_declined_by_me' : 'call_log_declined';
    case 'cancelled':
      return 'call_log_cancelled';
    case 'busy':
      return 'call_log_busy';
    case 'failed':
      return 'call_log_failed';
    case 'ended':
      return incoming ? 'call_log_incoming' : 'call_log_outgoing';
  }
}

/** Whether a call-log entry is shown as a problem (error colour). */
export function isUnsuccessfulCall(entry: CallLogEntry): boolean {
  return entry.outcome !== 'ended' && entry.outcome !== 'cancelled';
}
