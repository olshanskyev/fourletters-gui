import { base64, currentTimestamp, timeLeft } from './helpers';

interface JwtTokenPayload {
  exp?: number;
  jti?: string;
}
export class JwtToken {
  constructor(private rawToken: string) {}

  private _payload?: JwtTokenPayload;

  private get payload(): JwtTokenPayload {
    if (!this.rawToken) {
      return {};
    }

    if (this._payload) {
      return this._payload;
    }

    const parts = this.rawToken.split('.');
    if (parts.length !== 3) {
      return {}; // invalid JWT
    }

    try {
      const data = JSON.parse(base64.decode(parts[1]));
      return (this._payload = data);
    } catch {
      return {};
    }
  }

  private hasAccessToken() {
    return !!this.rawToken;
  }

  private isExpired() {
    return this.exp !== undefined && this.exp - currentTimestamp() <= 0;
  }

  get exp(): number | undefined {
    return this.payload?.exp;
  }

  get jti(): string | undefined {
    return this.payload?.jti;
  }


  get access_token() {
    return this.rawToken;
  }

  valid() {
    return this.hasAccessToken() && !this.isExpired();
  }

  getBearerToken() {
    return this.rawToken ? `Bearer ${this.rawToken}` : '';
  }

  needRefresh() {
    return this.exp !== undefined && this.exp >= 0;
  }

  getRefreshTime() {
    return timeLeft((this.exp ?? 0) - 15);
  }
}
