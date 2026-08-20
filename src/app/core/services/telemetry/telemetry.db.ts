import Dexie, { Table } from 'dexie';
import { BufferedTelemetryRecord } from './models';

/**
 * Standalone (non-per-user) buffer for outgoing telemetry LogRecords, so errors raised before
 * login — or across account switches — are still captured and eventually flushed.
 */
export class TelemetryDatabase extends Dexie {
  records!: Table<BufferedTelemetryRecord, number>;

  constructor() {
    super('fourletters:telemetry');
    this.version(1).stores({
      records: '++id, timeUnixNano'
    });
  }
}
