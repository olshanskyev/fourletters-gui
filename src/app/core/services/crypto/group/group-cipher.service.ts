// Group Sender-Key cipher. Each member owns a per-group Sender Key: a symmetric
// chain key that ratchets forward one message key per message (forward secrecy for that member's
// stream) plus a Curve25519 signature key pair so every group message is authenticated. A member
// distributes its Sender Key once per epoch via a Sender Key Distribution Message (SKDM) carried
// over the pairwise Double Ratchet; thereafter a group message is encrypted ONCE and the same
// ciphertext is delivered to every member
import { Injectable, inject } from '@angular/core';
import SignalProtocol, { Curve } from '@privacyresearch/libsignal-protocol-typescript';
import { GroupKeyStore } from './group-store';
import { GroupPeerKeyRecord, GroupSenderKeyRecord } from '@core/services/database/app.database';
import { Base64 } from '../../helpers';

const GROUP_PAYLOAD_TYPE = 4; // wire sessionType for a group Sender-Key message
const MAX_SKIP = 2000; // bound on how far a peer chain may ratchet forward for one message
const SEED_MESSAGE = 0x01; // HMAC seed: chain key -> message key
const SEED_CHAIN = 0x02; // HMAC seed: chain key -> next chain key

/** The Sender Key state a member shares so peers can read its group messages. */
export interface SenderKeyDistribution {
  groupId: string;
  epoch: number;
  chainKey: string; // Base64 chain key at `iteration`
  iteration: number;
  sigPubKey: string; // Base64 Curve25519 signature public key
}

/** Thrown when a group payload cannot be decrypted (missing Sender Key, bad signature, stale key). */
export class GroupUndecryptableError extends Error {
  constructor(public readonly senderId: string, public readonly groupId: string, cause?: unknown) {
    super(`Cannot decrypt group payload from ${senderId} in ${groupId} (missing/invalid Sender Key).`);
    this.name = 'GroupUndecryptableError';
    this.cause = cause;
  }
}

@Injectable({ providedIn: 'root' })
export class GroupCipherService {
  private readonly store = inject(GroupKeyStore);
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private curvePromise?: Promise<Curve>;

  /** Whether the wire payload is a group Sender-Key message (sessionType 4). */
  isGroupPayload(payload: string): boolean {
    return payload.startsWith(`${GROUP_PAYLOAD_TYPE}.`);
  }

  /**
   * This device's Sender Key for the group epoch, generating a fresh one (random chain key + a
   * per-group Curve25519 signature key pair) on first use of that epoch.
   */
  async getOrCreateSenderKey(groupId: string, epoch: number): Promise<GroupSenderKeyRecord> {
    const existing = await this.store.getSenderKey(groupId, epoch);
    if (existing) {
      return existing;
    }
    const curve = await this.getCurve();
    const sigKeys = curve.generateKeyPair();
    const chainKey = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const record: GroupSenderKeyRecord = {
      id: `${groupId}:${epoch}`,
      groupId,
      epoch,
      chainKey,
      iteration: 0,
      sigPubKey: sigKeys.pubKey,
      sigPrivKey: sigKeys.privKey,
      distributedTo: []
    };
    await this.store.putSenderKey(record);
    return record;
  }

  /** The Sender Key Distribution Message to hand a member so they can read this device's messages. */
  async buildDistribution(groupId: string, epoch: number): Promise<SenderKeyDistribution> {
    const sk = await this.getOrCreateSenderKey(groupId, epoch);
    return {
      groupId,
      epoch,
      chainKey: Base64.bufferToBase64(sk.chainKey),
      iteration: sk.iteration,
      sigPubKey: Base64.bufferToBase64(sk.sigPubKey)
    };
  }

  /** Members already holding this device's current Sender Key (so distribution can be skipped). */
  async distributedMembers(groupId: string, epoch: number): Promise<string[]> {
    const sk = await this.store.getSenderKey(groupId, epoch);
    return sk?.distributedTo ?? [];
  }

  /** Record that members have received this device's Sender Key for the epoch (lazy distribution). */
  async markDistributed(groupId: string, epoch: number, memberIds: string[]): Promise<void> {
    const sk = await this.getOrCreateSenderKey(groupId, epoch);
    const set = new Set(sk.distributedTo);
    memberIds.forEach(id => set.add(id));
    sk.distributedTo = [...set];
    await this.store.putSenderKey(sk);
  }

  /** Forget a member from the distributed set so the next send redistributes the Sender Key. */
  async clearDistribution(groupId: string, epoch: number, memberId: string): Promise<void> {
    const sk = await this.store.getSenderKey(groupId, epoch);
    if (!sk) {
      return;
    }
    sk.distributedTo = sk.distributedTo.filter(id => id !== memberId);
    await this.store.putSenderKey(sk);
  }

  /** Store a peer's Sender Key learned from their distribution message. */
  async applyDistribution(senderId: string, skdm: SenderKeyDistribution): Promise<void> {
    const record: GroupPeerKeyRecord = {
      id: `${skdm.groupId}:${skdm.epoch}:${senderId}`,
      groupId: skdm.groupId,
      epoch: skdm.epoch,
      senderId,
      chainKey: Base64.base64ToBuffer(skdm.chainKey),
      iteration: skdm.iteration,
      sigPubKey: Base64.base64ToBuffer(skdm.sigPubKey),
      skipped: {}
    };
    await this.store.putPeerKey(record);
  }

  /** Encrypt plaintext once with this device's Sender Key; returns the wire payload `4.<b64>`. */
  async encrypt(groupId: string, epoch: number, plaintext: string): Promise<string> {
    const sk = await this.getOrCreateSenderKey(groupId, epoch);
    const iteration = sk.iteration;
    const msgKey = await this.hmac(sk.chainKey, SEED_MESSAGE);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await crypto.subtle.importKey('raw', msgKey, 'AES-GCM', false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, aesKey, this.encoder.encode(plaintext)
    );

    const curve = await this.getCurve();
    const signature = curve.calculateSignature(sk.sigPrivKey, ciphertext);

    // Ratchet the chain forward and persist so the next message uses a fresh, unrecoverable key.
    sk.chainKey = await this.hmac(sk.chainKey, SEED_CHAIN);
    sk.iteration = iteration + 1;
    await this.store.putSenderKey(sk);

    const env = {
      e: epoch,
      i: iteration,
      c: Base64.bufferToBase64(ciphertext),
      iv: Base64.bufferToBase64(iv.buffer),
      s: Base64.bufferToBase64(signature)
    };
    return `${GROUP_PAYLOAD_TYPE}.${btoa(JSON.stringify(env))}`;
  }

  /** Decrypt a group Sender-Key payload from a peer; throws GroupUndecryptableError if unreadable. */
  async decrypt(senderId: string, groupId: string, payload: string): Promise<string> {
    let env: { e: number; i: number; c: string; iv: string; s: string };
    try {
      env = JSON.parse(atob(payload.slice(payload.indexOf('.') + 1)));
    } catch (err) {
      throw new GroupUndecryptableError(senderId, groupId, err);
    }

    const peer = await this.store.getPeerKey(groupId, env.e, senderId);
    if (!peer) {
      throw new GroupUndecryptableError(senderId, groupId, 'no sender key for epoch');
    }

    const ciphertext = Base64.base64ToBuffer(env.c);
    const curve = await this.getCurve();
    // NaCl convention: verifySignature returns TRUE when INVALID (0 = valid), so negate it here.
    const invalid = curve.verifySignature(peer.sigPubKey, ciphertext, Base64.base64ToBuffer(env.s));
    if (invalid) {
      throw new GroupUndecryptableError(senderId, groupId, 'bad signature');
    }

    const msgKey = await this.messageKeyFor(peer, env.i);
    if (!msgKey) {
      throw new GroupUndecryptableError(senderId, groupId, 'message key unavailable');
    }

    try {
      const aesKey = await crypto.subtle.importKey('raw', msgKey, 'AES-GCM', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(Base64.base64ToBuffer(env.iv)) }, aesKey, ciphertext
      );
      await this.store.putPeerKey(peer); // persist the advanced chain / skipped-key cache
      return this.decoder.decode(plain);
    } catch (err) {
      throw new GroupUndecryptableError(senderId, groupId, err);
    }
  }

  // --- internals -----------------------------------------------------------------------
  /**
   * Message key for a given iteration, ratcheting the peer's chain forward and caching any skipped
   * keys so out-of-order (live vs. inbox) messages still decrypt. Mutates {@code peer}; the caller
   * persists it only after a successful decrypt.
   */
  private async messageKeyFor(peer: GroupPeerKeyRecord, iteration: number)
    : Promise<ArrayBuffer | undefined> {
    const cached = peer.skipped[iteration];
    if (cached) {
      delete peer.skipped[iteration];
      return Base64.base64ToBuffer(cached);
    }
    if (iteration < peer.iteration) {
      return undefined; // already consumed and not retained
    }
    if (iteration - peer.iteration > MAX_SKIP) {
      return undefined; // too far ahead — refuse to do unbounded work
    }
    let chainKey = peer.chainKey;
    for (let k = peer.iteration; k < iteration; k++) {
      const mk = await this.hmac(chainKey, SEED_MESSAGE);
      peer.skipped[k] = Base64.bufferToBase64(mk);
      chainKey = await this.hmac(chainKey, SEED_CHAIN);
    }
    const msgKey = await this.hmac(chainKey, SEED_MESSAGE);
    peer.chainKey = await this.hmac(chainKey, SEED_CHAIN);
    peer.iteration = iteration + 1;
    return msgKey;
  }

  private async hmac(keyBytes: ArrayBuffer, seed: number): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    return crypto.subtle.sign('HMAC', key, new Uint8Array([seed]));
  }

  private getCurve(): Promise<Curve> {
    this.curvePromise ??= SignalProtocol().then(lib => lib.Curve);
    return this.curvePromise;
  }
}
