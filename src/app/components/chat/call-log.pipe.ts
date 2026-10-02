import { Pipe, PipeTransform } from '@angular/core';
import { CallLogEntry } from '@core/services/messages/models/messages.model';
import {
  callLogKey, formatCallDuration, isUnsuccessfulCall
} from '@components/call/call-utils';

export interface CallLogView {
  key: string;
  icon: string;
  unsuccessful: boolean;
  duration?: string;
}

/** Turns a call-log entry into what the chat timeline renders for it. */
@Pipe({
  name: 'callLog',
  standalone: true
})
export class CallLogPipe implements PipeTransform {
  transform(entry: CallLogEntry): CallLogView {
    return {
      key: callLogKey(entry),
      icon: entry.media === 'video' ? 'videocam' : 'call',
      unsuccessful: isUnsuccessfulCall(entry),
      duration: entry.durationSec ? formatCallDuration(entry.durationSec) : undefined
    };
  }
}
