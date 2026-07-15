import { Injector } from '@angular/core';

import { GroupCipherService, GroupUndecryptableError } from './group-cipher.service';
import { GroupKeyStore } from './group-store';
import { GroupPeerKeyRecord, GroupSenderKeyRecord } from '@core/services/database/app.database';
import { Base64 } from '../../helpers';

/**
 * In-memory GroupKeyStore. Holds record references directly: the cipher reads a record, mutates it,
 * then writes it back, so reference storage preserves the exact ArrayBuffers the Signal library
 * created (a structured clone would move them to another realm and break `instanceof ArrayBuffer`).
 */
class FakeGroupKeyStore {
  private senderKeys = new Map<string, GroupSenderKeyRecord>();
  private peerKeys = new Map<string, GroupPeerKeyRecord>();

  async getSenderKey(groupId: string, epoch: number): Promise<GroupSenderKeyRecord | undefined> {
    return this.senderKeys.get(`${groupId}:${epoch}`);
  }

  async putSenderKey(record: GroupSenderKeyRecord): Promise<void> {
    this.senderKeys.set(record.id, record);
  }

  async getPeerKey(
    groupId: string,
    epoch: number,
    senderId: string
  ): Promise<GroupPeerKeyRecord | undefined> {
    return this.peerKeys.get(`${groupId}:${epoch}:${senderId}`);
  }

  async putPeerKey(record: GroupPeerKeyRecord): Promise<void> {
    this.peerKeys.set(record.id, record);
  }
}

/** A group Sender-Key wire envelope (`4.<base64 JSON>`). */
interface GroupEnvelope {
  e: number;
  i: number;
  c: string;
  iv: string;
  s: string;
}

/** Build a GroupCipherService backed by an isolated in-memory store (one per simulated device). */
function makeCipher(): GroupCipherService {
  const injector = Injector.create({
    providers: [
      { provide: GroupKeyStore, useValue: new FakeGroupKeyStore() },
      { provide: GroupCipherService, useClass: GroupCipherService, deps: [] }
    ]
  });
  return injector.get(GroupCipherService);
}

/** Decode a wire payload, mutate the envelope, and re-encode it (to craft tampered inputs). */
function tamper(payload: string, mutate: (env: GroupEnvelope) => void): string {
  const env: GroupEnvelope = JSON.parse(atob(payload.slice(payload.indexOf('.') + 1)));
  mutate(env);
  return `4.${btoa(JSON.stringify(env))}`;
}

describe('GroupCipherService', () => {
  const GROUP = 'group-1';
  const EPOCH = 0;
  const ALICE = 'alice';

  let alice: GroupCipherService; // sender
  let bob: GroupCipherService; // recipient

  beforeEach(() => {
    alice = makeCipher();
    bob = makeCipher();
  });

  /** Hand Alice's current Sender Key to Bob, as the lazy SKDM distribution does before a send. */
  async function distribute(): Promise<void> {
    const skdm = await alice.buildDistribution(GROUP, EPOCH);
    await bob.applyDistribution(ALICE, skdm);
  }

  it('identifies group Sender-Key payloads by sessionType 4', () => {
    expect(alice.isGroupPayload('4.abc')).toBe(true);
    expect(alice.isGroupPayload('3.abc')).toBe(false);
    expect(alice.isGroupPayload('plain text')).toBe(false);
  });

  it('round-trips a single message from sender to recipient', async () => {
    await distribute();
    const payload = await alice.encrypt(GROUP, EPOCH, 'hello group');
    expect(alice.isGroupPayload(payload)).toBe(true);
    await expect(bob.decrypt(ALICE, GROUP, payload)).resolves.toBe('hello group');
  });

  it('decrypts consecutive in-order messages', async () => {
    await distribute();
    const p0 = await alice.encrypt(GROUP, EPOCH, 'm0');
    const p1 = await alice.encrypt(GROUP, EPOCH, 'm1');
    const p2 = await alice.encrypt(GROUP, EPOCH, 'm2');

    expect(await bob.decrypt(ALICE, GROUP, p0)).toBe('m0');
    expect(await bob.decrypt(ALICE, GROUP, p1)).toBe('m1');
    expect(await bob.decrypt(ALICE, GROUP, p2)).toBe('m2');
  });

  it('decrypts out-of-order messages via the skipped-key cache', async () => {
    await distribute();
    const p0 = await alice.encrypt(GROUP, EPOCH, 'm0');
    const p1 = await alice.encrypt(GROUP, EPOCH, 'm1');
    const p2 = await alice.encrypt(GROUP, EPOCH, 'm2');

    // Receive newest first: this ratchets past 0 and 1, caching their message keys.
    expect(await bob.decrypt(ALICE, GROUP, p2)).toBe('m2');
    expect(await bob.decrypt(ALICE, GROUP, p0)).toBe('m0');
    expect(await bob.decrypt(ALICE, GROUP, p1)).toBe('m1');
  });

  it('rejects a replayed (already-consumed) iteration', async () => {
    await distribute();
    const p0 = await alice.encrypt(GROUP, EPOCH, 'm0');
    const p1 = await alice.encrypt(GROUP, EPOCH, 'm1');

    expect(await bob.decrypt(ALICE, GROUP, p1)).toBe('m1'); // caches key for iteration 0
    expect(await bob.decrypt(ALICE, GROUP, p0)).toBe('m0'); // consumes the cached key

    await expect(bob.decrypt(ALICE, GROUP, p0)).rejects.toBeInstanceOf(GroupUndecryptableError);
  });

  it('throws when no Sender Key was distributed for the epoch', async () => {
    const payload = await alice.encrypt(GROUP, EPOCH, 'secret');
    await expect(bob.decrypt(ALICE, GROUP, payload))
            .rejects.toBeInstanceOf(GroupUndecryptableError);
  });

  it('rejects a payload with a tampered signature', async () => {
    await distribute();
    const payload = await alice.encrypt(GROUP, EPOCH, 'authentic');
    const forged = tamper(payload, env => {
      const sig = new Uint8Array(Base64.base64ToBuffer(env.s));
      sig[0] ^= 0xff;
      env.s = Base64.bufferToBase64(sig.buffer);
    });
    await expect(bob.decrypt(ALICE, GROUP, forged)).rejects.toBeInstanceOf(GroupUndecryptableError);
  });

  it('rejects a payload whose ciphertext was altered', async () => {
    await distribute();
    const payload = await alice.encrypt(GROUP, EPOCH, 'authentic');
    const forged = tamper(payload, env => {
      const ct = new Uint8Array(Base64.base64ToBuffer(env.c));
      ct[0] ^= 0xff;
      env.c = Base64.bufferToBase64(ct.buffer);
    });
    await expect(bob.decrypt(ALICE, GROUP, forged)).rejects.toBeInstanceOf(GroupUndecryptableError);
  });

  it('refuses to ratchet a peer chain past MAX_SKIP', async () => {
    await distribute();
    const payload = await alice.encrypt(GROUP, EPOCH, 'far ahead');
    // Keep the valid signature/ciphertext but claim an iteration beyond MAX_SKIP (2000).
    const forged = tamper(payload, env => {
      env.i = 2001;
    });
    await expect(bob.decrypt(ALICE, GROUP, forged)).rejects.toBeInstanceOf(GroupUndecryptableError);
  });

  it('tracks lazy distribution bookkeeping idempotently', async () => {
    expect(await alice.distributedMembers(GROUP, EPOCH)).toEqual([]);

    await alice.markDistributed(GROUP, EPOCH, ['bob', 'carol']);
    expect([...(await alice.distributedMembers(GROUP, EPOCH))].sort()).toEqual(['bob', 'carol']);

    await alice.markDistributed(GROUP, EPOCH, ['bob']); // re-marking is a no-op
    expect([...(await alice.distributedMembers(GROUP, EPOCH))].sort()).toEqual(['bob', 'carol']);

    await alice.clearDistribution(GROUP, EPOCH, 'bob'); // forces redistribution to bob only
    expect(await alice.distributedMembers(GROUP, EPOCH)).toEqual(['carol']);
  });
});
