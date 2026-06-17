import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { EncryptedMessage } from '../../dto/encryptedMessage';
import { AcceptedResponse } from '../../dto/acceptedResponse';
import { InboxResponse } from '../../dto/inboxResponse';
import { DeliveryReceipt, DeliveryReceiptTypeEnum } from '../../dto/deliveryReceipt';

/**
 * REST client for the Server's message endpoints
 */
@Injectable({
  providedIn: 'root'
})
export class MessagesApiService {
  private readonly httpClient = inject(HttpClient);

  /**
   * Send a message to a recipient. Returns the Server's acceptance (messageId + seq).
   * @param recipientId the recipient user id
   * @param payload the (eventually encrypted) message body
   * @param messageId optional client-generated id; one is created if omitted
   */
  sendMessage(recipientId: string, payload: string, messageId: string = crypto.randomUUID())
  : Observable<AcceptedResponse> {
    const message: EncryptedMessage = {
      messageId,
      recipientId,
      payload,
      signature: '' // placeholder until E2E signing is implemented
    };
    return this.httpClient.post<AcceptedResponse>('/messages', message);
  }

  /**
   * Sync undelivered messages from the Server-owned inbox.
   * @param since return messages with seq strictly greater than this value
   */
  fetchInbox(since = 0): Observable<InboxResponse> {
    return this.httpClient.get<InboxResponse>('/inbox', { params: { since } });
  }

  /**
   * Acknowledge a received message with a signed delivery/read receipt (signature is a
   * placeholder for now). Receipts go to the Server, never to a Hub.
   */
  sendReceipt(messageId: string, type: DeliveryReceiptTypeEnum = DeliveryReceiptTypeEnum.Delivered)
    : Observable<void> {
    const receipt: DeliveryReceipt = {
      messageId,
      type,
      signature: '' // placeholder until E2E signing is implemented
    };
    return this.httpClient.post<void>('/receipts', receipt);
  }
}
