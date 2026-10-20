import { getActiveApiBaseUrl } from './config';
import { getAuthToken } from './secureStore';

export interface ApiError {
  message: string;
  status: number;
  data?: any;
}

/**
 * Core HTTP fetch wrapper connecting to the configurable backend.
 * Provides authenticated network requests with token injection and structured error handling.
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
      data,
    } as ApiError;
  }

  return data as T;
}
