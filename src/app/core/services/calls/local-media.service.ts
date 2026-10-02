import { Injectable, signal } from '@angular/core';
import { describeError } from './call-telemetry';
import { CallMedia } from './models/call.model';

/** Microphone and camera of the current call, and their controls. */
@Injectable({
  providedIn: 'root'
})
export class LocalMediaService {
  readonly localStream = signal<MediaStream | null>(null);
  readonly muted = signal(false);
  readonly cameraOff = signal(false);
  readonly canSwitchCamera = signal(false);

  private facingMode: 'user' | 'environment' = 'user';

  /** Open microphone (and camera); the stream is the call's only after {@link use}. */
  async open(media: CallMedia): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === 'video' ? { facingMode: this.facingMode } : false
    });
    if (media === 'video') {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.canSwitchCamera.set(devices.filter(d => d.kind === 'videoinput').length > 1);
    }
    return stream;
  }

  use(stream: MediaStream): void {
    this.localStream.set(stream);
  }

  toggleMute(): void {
    const muted = !this.muted();
    this.localStream()?.getAudioTracks().forEach(track => (track.enabled = !muted));
    this.muted.set(muted);
  }

  toggleCamera(): void {
    const off = !this.cameraOff();
    this.localStream()?.getVideoTracks().forEach(track => (track.enabled = !off));
    this.cameraOff.set(off);
  }

  /** Flip between front and back camera; `sender` swaps the track without renegotiating. */
  async switchCamera(sender: RTCRtpSender): Promise<void> {
    const stream = this.localStream();
    const oldTrack = stream?.getVideoTracks()[0];
    if (!stream || !oldTrack) {
      return;
    }
    const facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    let newTrack: MediaStreamTrack | undefined;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      newTrack = replacement.getVideoTracks()[0];
      newTrack.enabled = !this.cameraOff();
      await sender.replaceTrack(newTrack);
    } catch (err) {
      newTrack?.stop();
      console.warn('Camera switch failed', JSON.stringify({ error: describeError(err) }));
      throw err;
    }
    oldTrack.stop();
    this.facingMode = facingMode;
    this.localStream.set(new MediaStream([...stream.getAudioTracks(), newTrack]));
  }

  /** Stop all local tracks and reset the controls. */
  release(): void {
    this.localStream()?.getTracks().forEach(track => track.stop());
    this.localStream.set(null);
    this.muted.set(false);
    this.cameraOff.set(false);
    this.canSwitchCamera.set(false);
    this.facingMode = 'user';
  }
}
