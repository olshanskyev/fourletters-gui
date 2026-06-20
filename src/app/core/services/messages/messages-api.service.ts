import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { EncryptedMessage } from '../../dto/encryptedMessage';
import { AcceptedResponse } from '../../dto/acceptedResponse';
import { InboxResponse } from '../../dto/inboxResponse';
import { DeliveryReceipt } from '../../dto/deliveryReceipt';
import { MessageBatchRequest } from '../../dto/messageBatchRequest';
import { MessageBatchResponse } from '../../dto/messageBatchResponse';
import { ReceiptType } from '../../dto/models';
import { ConversationType } from '../..';

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
   * @param payload the encrypted E2E message body
   * @param signature the ECDSA signature of the payload
   * @param messageId optional client-generated id; one is created if omitted
   */
  sendMessage(
    recipientId: string,
    payload: string,
    signature: string,
    messageId: string = crypto.randomUUID(),
    receipientType: ConversationType = 'direct' // toDo: group sending
  ): Observable<AcceptedResponse> {
    const message: EncryptedMessage = {
      messageId,
      recipientId,
      payload,
      signature
    };
    return this.httpClient.post<AcceptedResponse>('/messages', message);
  }

  /**
   * Submit a batch of messages (resync)
   */
  sendMessagesBatch(messages: EncryptedMessage[]): Observable<MessageBatchResponse> {
    const request: MessageBatchRequest = { messages };
    return this.httpClient.post<MessageBatchResponse>('/messages/batch', request);
  }

  /**
   * Sync undelivered messages from the Server-owned inbox.
   */
  fetchInbox(): Observable<InboxResponse> {
    return this.httpClient.get<InboxResponse>('/inbox');
  }

  /**
   * Acknowledge a received message with a signed delivery/read receipt.
   * Receipts go to the Server, never to a Hub.
   */
  sendReceipt(
    messageId: string,
    originalSenderId: string,
    signature: string,
    type: ReceiptType = ReceiptType.Delivered
  ): Observable<void> {
    const receipt: DeliveryReceipt = {
      messageId,
      originalSenderId,
      type,
      signature
    };
    return this.httpClient.post<void>('/receipts', receipt);
  }
}
