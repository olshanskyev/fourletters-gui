import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/services/authentication/auth.service';
import {
  TelemetryLogBatch,
  TelemetryLogRecord,
  TelemetryLogRecordSeverityTextEnum,
  TelemetryResource
} from '@dto/models';
import { TelemetryApiService } from './telemetry-api.service';
import { TelemetryDatabase } from './telemetry.db';
import { BufferedTelemetryRecord } from './models';

/** OTel SeverityNumber for the two levels we capture. */
const SEVERITY_NUMBER: Record<TelemetryLogRecordSeverityTextEnum, number> = {
  [TelemetryLogRecordSeverityTextEnum.Warn]: 13,
  [TelemetryLogRecordSeverityTextEnum.Error]: 17
};

/**
 * Captures client warnings/errors as OpenTelemetry LogRecords, buffers them offline in a
 * standalone IndexedDB store, and ships redacted batches to the Server for analysis.
 *
 * Capture is wired by patching console.warn/console.error: Angular's global error listeners funnel
 * uncaught errors and rejections through the default ErrorHandler (which calls console.error), so a
 * single console patch covers both explicit logs and uncaught failures without double-counting. The
 * payload is diagnostics only — bodies/attributes are scrubbed of tokens, emails and blobs, and it
 * never carries end-to-end message content.
 */
@Injectable({
  providedIn: 'root'
})
export class TelemetryService {
  private readonly api = inject(TelemetryApiService);
  private readonly auth = inject(AuthService);

  private static readonly SERVICE_NAME = 'fourletters-gui';
  private static readonly BATCH_SIZE = 20;
  private static readonly FLUSH_INTERVAL_MS = 30_000;
  private static readonly MAX_BUFFER = 500;
  private static readonly MAX_BODY = 4096;

  private readonly db = new TelemetryDatabase();
  private readonly sessionId = crypto.randomUUID();
  private started = false;
  private flushing = false;
  private inCapture = false;

  /** Wire global capture + periodic flush. Idempotent; safe to call before login. */
  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;
    this.patchConsole();

    setInterval(() => void this.flush(), TelemetryService.FLUSH_INTERVAL_MS);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushOnUnload();
      }
    });
    window.addEventListener('pagehide', () => this.flushOnUnload());

    void this.flush();
  }

  /** Replace console.warn/error with wrappers that log locally first, then capture. */
  private patchConsole(): void {
    console.warn = this.wrapConsole(
      console.warn.bind(console), TelemetryLogRecordSeverityTextEnum.Warn
    );
    console.error = this.wrapConsole(
      console.error.bind(console), TelemetryLogRecordSeverityTextEnum.Error
    );
  }

  private wrapConsole(
    original: (...args: unknown[]) => void,
    severity: TelemetryLogRecordSeverityTextEnum
  ): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      original(...args);
      if (this.inCapture) {
        return; // guard against re-entrancy if capture ever logs
      }
      this.inCapture = true;
      try {
        void this.persist(this.buildRecord(severity, argsToMessage(args)));
      } catch {
        // Telemetry is best-effort; never let capture disturb the caller.
      } finally {
        this.inCapture = false;
      }
    };
  }

  private buildRecord(
    severity: TelemetryLogRecordSeverityTextEnum,
    message: string
  ): BufferedTelemetryRecord {
    return {
      timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
      severityText: severity,
      severityNumber: SEVERITY_NUMBER[severity],
      body: scrub(message).slice(0, TelemetryService.MAX_BODY),
      attributes: {
        'url.path': location?.pathname ?? '',
        'app.online': navigator.onLine
      }
    };
  }

  private async persist(record: BufferedTelemetryRecord): Promise<void> {
    try {
      await this.db.records.add(record);
      const count = await this.db.records.count();
      if (count > TelemetryService.MAX_BUFFER) {
        const overflow = count - TelemetryService.MAX_BUFFER;
        const oldest = await this.db.records.orderBy('id').limit(overflow).primaryKeys();
        await this.db.records.bulkDelete(oldest);
      }
    } catch {
      // Buffering is best-effort (e.g. storage disabled/full).
    }
  }

  /** Send buffered records in batches while the app is alive. No-op without a valid token. */
  private async flush(): Promise<void> {
    if (this.flushing || !this.auth.tokenReader.isTokenValid()) {
      return;
    }
    this.flushing = true;
    try {
      for (;;) {
        const records = await this.db.records
          .orderBy('id')
          .limit(TelemetryService.BATCH_SIZE)
          .toArray();
        if (records.length === 0) {
          break;
        }
        await firstValueFrom(this.api.submit(toBatch(this.resource(), records)));
        await this.db.records.bulkDelete(ids(records));
        if (records.length < TelemetryService.BATCH_SIZE) {
          break;
        }
      }
    } catch {
      // Leave records buffered for the next attempt (e.g. offline / 401 before login).
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Flush a final small batch as the page is hidden/unloaded via fetch keepalive. Raw fetch
   * bypasses the interceptors, so the absolute URL and bearer token are attached manually.
   */
  private flushOnUnload(): void {
    if (!this.auth.tokenReader.isTokenValid()) {
      return;
    }
    void this.db.records
      .orderBy('id')
      .limit(TelemetryService.BATCH_SIZE)
      .toArray()
      .then(records => {
        if (records.length === 0) {
          return;
        }
        fetch(`${environment.baseUrlServer}/telemetry/logs`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.auth.tokenReader.getBearerToken()
          },
          body: JSON.stringify(toBatch(this.resource(), records))
        })
          .then(() => this.db.records.bulkDelete(ids(records)))
          .catch(() => undefined);
      });
  }

  private resource(): TelemetryResource {
    return {
      serviceName: TelemetryService.SERVICE_NAME,
      sessionId: this.sessionId,
      userAgent: navigator.userAgent
    };
  }
}

/** Strip the Dexie key so the record matches the wire DTO. */
function toBatch(resource: TelemetryResource, records: BufferedTelemetryRecord[])
    : TelemetryLogBatch {
  const logRecords: TelemetryLogRecord[] = records.map(({ id, ...rest }) => rest);
  return { resource, logRecords };
}

function ids(records: BufferedTelemetryRecord[]): number[] {
  return records.map(r => r.id).filter((id): id is number => id !== undefined);
}

/** Best-effort flatten of console arguments into a single message string. */
function argsToMessage(args: unknown[]): string {
  return args
    .map(arg => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
      }
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/** Redact obvious secrets/PII before a message leaves the device. */
function scrub(text: string): string {
  return text
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[redacted]');
}
