import { apiRequest } from './api';
import type {
  ActiveIntentsResponse,
  CreateUpiIntentPayload,
  IntentActionPayload,
  IntentActionResponse,
  IntentStatusResponse,
  ServerConfigResponse,
  UpiIntentResponse,
} from '../types/api';

/**
 * Payment API service for Direct UPI settlements and payment intent lifecycle.
 * Centralizes all /api/payment endpoints using the shared apiRequest client.
 *
 * FINANCIAL ACCURACY RULES:
 * 1. The client must never mark a payment as successful or settled locally.
 * 2. Only the backend authoritatively records settlements and updates the ledger.
 * 3. Never send payment requests with unverified or unvalidated amounts.
 */
export const paymentApi = {
  /**
   * Creates a Direct UPI payment intent for a valid settlement debt.
   * Generates a standard upi:// deep-link URI with payee details.
   */
  createIntent: async (payload: CreateUpiIntentPayload): Promise<UpiIntentResponse> => {
    return apiRequest<UpiIntentResponse>('/payment/intent', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Transitions a pending intent to payer_claimed once the debtor has completed payment.
   * Sends background notification to recipient. Permitted only for debtor.
   */
  claim: async (payload: IntentActionPayload): Promise<IntentActionResponse> => {
    return apiRequest<IntentActionResponse>('/payment/claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Transitions a claimed intent to recipient_confirmed once the creditor confirms receipt.
   * Authoritatively updates the group ledger. Permitted only for creditor.
   */
  confirm: async (payload: IntentActionPayload): Promise<IntentActionResponse> => {
    return apiRequest<IntentActionResponse>('/payment/confirm', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Transitions a claimed intent to recipient_rejected if the creditor did not receive payment.
   * Does NOT alter the ledger. Permitted only for creditor.
   */
  reject: async (payload: IntentActionPayload): Promise<IntentActionResponse> => {
    return apiRequest<IntentActionResponse>('/payment/reject', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Transitions a pending intent to cancelled.
   * Permitted only while status is 'pending'. Claimed intents cannot be cancelled.
   */
  cancel: async (payload: IntentActionPayload): Promise<IntentActionResponse> => {
    return apiRequest<IntentActionResponse>('/payment/cancel', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Retrieves all active intents (pending or payer_claimed) involving the current user in a group.
   */
  getActiveIntents: async (groupId: string): Promise<ActiveIntentsResponse> => {
    return apiRequest<ActiveIntentsResponse>(`/payment/active/${groupId}`);
  },

  /**
   * Retrieves the current status of a specific payment intent.
   */
  getStatus: async (intentId: string): Promise<IntentStatusResponse> => {
    return apiRequest<IntentStatusResponse>(`/payment/status/${intentId}`);
  },

  /**
   * Fetches public server payment configuration (e.g. razorpayEnabled).
   */
  getConfig: async (): Promise<ServerConfigResponse> => {
    return apiRequest<ServerConfigResponse>('/config');
  },
};

