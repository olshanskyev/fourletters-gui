import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  EncryptedMessage,
  AcceptedResponse,
  InboxResponse,
  DeliveryReceipt,
  MessageBatchRequest,
  MessageBatchResponse,
  ReceiptType
} from '@dto/models';

/**
 * REST client for the Server's message endpoints
 */
@Injectable({
  providedIn: 'root'
})
export class MessagesApiService {
  private readonly httpClient = inject(HttpClient);

  sendMessage(
    recipientId: string,
    payload: string,
    signature: string,
    messageId: string = crypto.randomUUID()
  ): Observable<AcceptedResponse> {
    const message: EncryptedMessage = {
      messageId,
      recipientId,
      payload,
      signature
    };
    return this.httpClient.post<AcceptedResponse>('/messages', message);
  }

  sendGroupMessage(
    groupId: string,
    epoch: number,
    payload: string,
    signature: string,
    messageId: string = crypto.randomUUID()
  ): Observable<AcceptedResponse> {
    const message: EncryptedMessage = {
      messageId,
      recipientId: groupId,
      groupId,
      epoch,
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
