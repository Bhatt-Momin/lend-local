import { apiRequest, ApiError } from './client';
import { UserProfile } from './secureStore';
import type { UpdateUpiIdResponse } from '../types/api';

export { apiRequest, ApiError };

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface GetMeResponse {
  user: UserProfile;
}

export const authApi = {
  login: async (credentials: { email: string; password: string }): Promise<AuthResponse> => {
    return apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  register: async (userData: { name: string; email: string; password: string }): Promise<AuthResponse> => {
    return apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  getMe: async (token?: string): Promise<GetMeResponse> => {
    return apiRequest<GetMeResponse>('/auth/me', {
      method: 'GET',
    }, token);
  },

  updateUpiId: async (payload: { upiId: string | null }): Promise<UpdateUpiIdResponse> => {
    return apiRequest<UpdateUpiIdResponse>('/auth/upi-id', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  saveFcmToken: async (
    token: string,
    platform: 'web' | 'android' | 'ios' = 'android',
    authToken?: string
  ): Promise<{ message: string; platform?: string }> => {
    return apiRequest<{ message: string; platform?: string }>(
      '/auth/fcm-token',
      {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      },
      authToken
    );
  },

  removeFcmToken: async (token: string, authToken?: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(
      '/auth/fcm-token',
      {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      },
      authToken
    );
  },
};

// Re-export domain services and types for convenient centralized access
export { groupsApi } from './groupsApi';
export { expensesApi } from './expensesApi';
export { balancesApi } from './balancesApi';
export { paymentApi } from './paymentApi';
export { notificationsApi } from './notificationsApi';
export * from '../types/api';
