import { TelemetryLogRecord } from '@dto/models';

/** A buffered LogRecord awaiting flush; `id` is the Dexie autoincrement key. */
export interface BufferedTelemetryRecord extends TelemetryLogRecord {
  id?: number;
}
