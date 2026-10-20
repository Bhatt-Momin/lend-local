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
};

// Re-export domain services and types for convenient centralized access
export { groupsApi } from './groupsApi';
export { expensesApi } from './expensesApi';
export { balancesApi } from './balancesApi';
export { paymentApi } from './paymentApi';
export * from '../types/api';
