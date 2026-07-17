export class Base64 {
  static encode(plainText: string): string {
    return btoa(plainText).replace(/[+/=]/g, m => {
      return { '+': '-', '/': '_', '=': '' }[m] as string;
    });
  }

  static decode(b64: string): string {
    b64 = b64.replace(/[-_]/g, m => {
      return { '-': '+', '_': '/' }[m] as string;
    });
    while (b64.length % 4) {
      b64 += '=';
    }

    return atob(b64);
  }

  static bufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  static base64ToBuffer(b64: string): ArrayBuffer {
    const binary = Base64.decode(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export const base64 = { 
  encode: Base64.encode, 
  decode: Base64.decode, 
  bufferToBase64: Base64.bufferToBase64, 
  base64ToBuffer: Base64.base64ToBuffer 
};

export function capitalize(text: string): string {
  return text.substring(0, 1).toUpperCase() + text.substring(1, text.length).toLowerCase();
}

export function currentTimestamp(): number {
  return Math.ceil(new Date().getTime() / 1000);
}

export function timeLeft(expiredAt: number): number {
  return Math.max(0, expiredAt - currentTimestamp());
}

export function filterObject<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function isEmptyObject(obj: Record<string, any>) {
  return Object.keys(obj).length === 0;
}

/**
 * De-duplicates concurrent async calls that share a key: while a task for a given key is in flight,
 * subsequent calls with the same key return the same pending promise instead of starting a new one.
 * Once it settles (resolve or reject) the entry is cleared, so the next call starts fresh.
 *
 * Useful for collapsing redundant network fetches when several callers request the same resource at
 * once (e.g. a conversations list and a chat header both resolving the same group).
 */
export class InFlightRequests<K = string> {
  private readonly inFlight = new Map<K, Promise<unknown>>();

  /** Run `task` for `key`, sharing an already-running call for the same key if one exists. */
  run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    const pending = task().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }
}

