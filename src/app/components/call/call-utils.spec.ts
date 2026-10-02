import { callErrorKey, callLogKey, formatCallDuration, isUnsuccessfulCall } from './call-utils';

describe('call-utils', () => {
  it('formats call durations', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(65)).toBe('1:05');
    expect(formatCallDuration(3723)).toBe('1:02:03');
  });

  it('maps media errors to i18n keys', () => {
    expect(callErrorKey({ name: 'NotAllowedError' })).toBe('call_error_permission');
    expect(callErrorKey({ name: 'NotFoundError' })).toBe('call_error_no_device');
    expect(callErrorKey({ name: 'NotReadableError' })).toBe('call_error_device_busy');
    expect(callErrorKey(new Error('boom'))).toBe('call_error_generic');
  });

  it('describes a missed call from each side', () => {
    expect(callLogKey({ media: 'audio', direction: 'incoming', outcome: 'missed' }))
      .toBe('call_log_missed');
    expect(callLogKey({ media: 'audio', direction: 'outgoing', outcome: 'missed' }))
      .toBe('call_log_no_answer');
  });

  it('flags only calls that did not happen as unsuccessful', () => {
    expect(isUnsuccessfulCall({ media: 'video', direction: 'incoming', outcome: 'ended' }))
      .toBe(false);
    expect(isUnsuccessfulCall({ media: 'video', direction: 'outgoing', outcome: 'cancelled' }))
      .toBe(false);
    expect(isUnsuccessfulCall({ media: 'video', direction: 'incoming', outcome: 'missed' }))
      .toBe(true);
  });
});
