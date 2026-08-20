import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { TelemetryLogBatch, TelemetryAcceptedResponse } from '@dto/models';

/** REST client for the Server's telemetry ingestion endpoint. */
@Injectable({
  providedIn: 'root'
})
export class TelemetryApiService {
  private readonly httpClient = inject(HttpClient);

  submit(batch: TelemetryLogBatch): Observable<TelemetryAcceptedResponse> {
    return this.httpClient.post<TelemetryAcceptedResponse>('/telemetry/logs', batch);
  }
}
