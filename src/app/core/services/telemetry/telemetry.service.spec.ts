import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TelemetryLogRecordSeverityTextEnum } from '@dto/models';
import { TelemetryService } from './telemetry.service';
import { TelemetryApiService } from './telemetry-api.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { BufferedTelemetryRecord } from './models';

/** Minimal in-memory stand-in for the Dexie `records` table used by the service. */
function makeFakeDb(seed: BufferedTelemetryRecord[] = []) {
  let store: BufferedTelemetryRecord[] = seed.map(r => ({ ...r }));
  const table = {
    add: vi.fn(async (r: BufferedTelemetryRecord) => {
      const id = (store.length ? store[store.length - 1].id ?? 0 : 0) + 1;
      store.push({ ...r, id });
      return id;
    }),
    count: vi.fn(async () => store.length),
    bulkDelete: vi.fn(async (keys: number[]) => {
      store = store.filter(r => !keys.includes(r.id as number));
    }),
    orderBy: vi.fn(() => ({
      limit: (n: number) => ({
        toArray: async () => store.slice(0, n),
        primaryKeys: async () => store.slice(0, n).map(r => r.id as number)
      })
    }))
  };
  return { db: { records: table }, dump: () => store };
}

describe('TelemetryService', () => {
  let service: TelemetryService;
  let apiMock: { submit: ReturnType<typeof vi.fn> };
  let authMock: { tokenReader: { isTokenValid: ReturnType<typeof vi.fn>;
    getBearerToken: ReturnType<typeof vi.fn> } };
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    apiMock = { submit: vi.fn(() => of({ status: 'accepted', acceptedCount: 1 })) };
    authMock = {
      tokenReader: {
        isTokenValid: vi.fn().mockReturnValue(false),
        getBearerToken: vi.fn().mockReturnValue('Bearer test-token')
      }
    };

    TestBed.configureTestingModule({
      providers: [
        TelemetryService,
        { provide: TelemetryApiService, useValue: apiMock },
        { provide: AuthService, useValue: authMock }
      ]
    });
    service = TestBed.inject(TelemetryService);
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('scrubs tokens, emails and blobs and sets the OTel severity number', () => {
    const blob = 'A'.repeat(48);
    const message =
      `oops eyJhbGc.iOiJIUz.SflKxw me@example.com Bearer abcdef123456 ${blob}`;

    const record: BufferedTelemetryRecord =
      (service as any).buildRecord(TelemetryLogRecordSeverityTextEnum.Error, message);

    expect(record.severityText).toBe(TelemetryLogRecordSeverityTextEnum.Error);
    expect(record.severityNumber).toBe(17);
    expect(record.body).toContain('[jwt]');
    expect(record.body).toContain('[email]');
    expect(record.body).toContain('Bearer [redacted]');
    expect(record.body).toContain('[redacted]');
    expect(record.body).not.toContain('me@example.com');
    expect(record.body).not.toContain(blob);
    // OTLP/JSON int64-as-string timestamp.
    expect(typeof record.timeUnixNano).toBe('string');
  });

  it('captures a patched console.error into the buffer as ERROR', async () => {
    const fake = makeFakeDb();
    (service as any).db = fake.db;

    service.start();
    console.error('boom');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.db.records.add).toHaveBeenCalledTimes(1);
    const stored = fake.dump()[0];
    expect(stored.severityText).toBe(TelemetryLogRecordSeverityTextEnum.Error);
    expect(stored.body).toContain('boom');
  });

  it('flushes buffered records in a batch and deletes them once accepted', async () => {
    const seed: BufferedTelemetryRecord[] = [1, 2, 3].map(id => ({
      id,
      timeUnixNano: `${id}`,
      severityText: TelemetryLogRecordSeverityTextEnum.Warn,
      severityNumber: 13,
      body: `msg-${id}`
    }));
    const fake = makeFakeDb(seed);
    (service as any).db = fake.db;
    authMock.tokenReader.isTokenValid.mockReturnValue(true);

    await (service as any).flush();

    expect(apiMock.submit).toHaveBeenCalledTimes(1);
    const batch = apiMock.submit.mock.calls[0][0];
    expect(batch.resource.serviceName).toBe('fourletters-gui');
    expect(batch.logRecords).toHaveLength(3);
    // The Dexie key must not leak onto the wire DTO.
    expect(batch.logRecords[0].id).toBeUndefined();
    expect(fake.db.records.bulkDelete).toHaveBeenCalledWith([1, 2, 3]);
    expect(fake.dump()).toHaveLength(0);
  });

  it('does not flush without a valid token', async () => {
    const fake = makeFakeDb([{
      id: 1,
      timeUnixNano: '1',
      severityText: TelemetryLogRecordSeverityTextEnum.Error,
      severityNumber: 17,
      body: 'kept'
    }]);
    (service as any).db = fake.db;
    authMock.tokenReader.isTokenValid.mockReturnValue(false);

    await (service as any).flush();

    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(fake.dump()).toHaveLength(1);
  });

  it('drops the oldest record when the buffer overflows', async () => {
    const seed: BufferedTelemetryRecord[] = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      timeUnixNano: `${i + 1}`,
      severityText: TelemetryLogRecordSeverityTextEnum.Warn,
      severityNumber: 13,
      body: `m-${i + 1}`
    }));
    const fake = makeFakeDb(seed);
    (service as any).db = fake.db;

    await (service as any).persist({
      timeUnixNano: '999',
      severityText: TelemetryLogRecordSeverityTextEnum.Error,
      severityNumber: 17,
      body: 'newest'
    });

    expect(fake.db.records.bulkDelete).toHaveBeenCalledWith([1]);
  });
});
