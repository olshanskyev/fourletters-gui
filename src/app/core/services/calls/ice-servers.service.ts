import { Injectable } from '@angular/core';
import { environment } from '@env/environment';

/** Supplies the ICE servers a call's peer connection uses for NAT traversal. */
@Injectable({
  providedIn: 'root'
})
export class IceServersService {
  private static readonly ICE_URL = /^(stun|turns?):/;

  /** Async so a later TURN extension can fetch short-lived credentials here. */
  async getIceServers(): Promise<RTCIceServer[]> {
    const urls = (environment.stunUrls ?? '')
      .split(',')
      .map(url => url.trim())
      // Drops an unsubstituted __STUN_URLS__ placeholder as well as blanks.
      .filter(url => IceServersService.ICE_URL.test(url));
    return urls.length > 0 ? [{ urls }] : [];
  }
}
