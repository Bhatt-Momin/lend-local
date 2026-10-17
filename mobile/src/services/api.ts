import { getActiveApiBaseUrl } from './config';
import { getAuthToken, UserProfile } from './secureStore';
import type { UpdateUpiIdResponse } from '../types/api';

export interface ApiError {
  message: string;
  status: number;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface GetMeResponse {
  user: UserProfile;
}

/**
 * Core HTTP fetch wrapper connecting to the configurable backend.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  customToken?: string
): Promise<T> {
  const baseUrl = await getActiveApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${baseUrl}${cleanEndpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const token = customToken || (await getAuthToken());
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  let responseText = '';

  try {
    response = await fetch(fullUrl, {
      ...options,
      headers,
    });
    responseText = await response.text();
  } catch (err: any) {
    const errorMsg = err?.message || 'Network request failed';
    const isConnRefused = errorMsg.includes('Failed to connect') || errorMsg.includes('Network request failed');
    throw {
      message: isConnRefused
        ? `Cannot connect to server at ${baseUrl}. Ensure backend is running and reachable.`
        : errorMsg,
      status: 0,
    } as ApiError;
  }

  let data: any = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { message: responseText };
    }
  }

  if (!response.ok) {
    const message = (data && data.message) || `Request failed with status ${response.status}`;
    throw {
      message,
      status: response.status,
    } as ApiError;
  }

  return data as T;
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
