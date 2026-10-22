import { getActiveApiBaseUrl } from './config';
import { getAuthToken } from './secureStore';

export interface ApiError {
  message: string;
  status: number;
  data?: any;
}

export const DEFAULT_TIMEOUT_MS = 25000;

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Core HTTP fetch wrapper connecting to the configurable backend.
 * Provides authenticated network requests with token injection, timeout resilience,
 * and structured error handling.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {},
  customToken?: string
): Promise<T> {
  const { timeoutMs: customTimeoutMs, signal: callerSignal, headers: customHeaders, ...fetchOptions } = options;

  // Handle pre-aborted caller signal immediately without creating a timer
  if (callerSignal?.aborted) {
    throw {
      message: 'Request was cancelled',
      status: 0,
    } as ApiError;
  }

  const baseUrl = await getActiveApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${baseUrl}${cleanEndpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string> || {}),
  };

  const token = customToken || (await getAuthToken());
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const timeoutMs =
    typeof customTimeoutMs === 'number' && Number.isFinite(customTimeoutMs) && customTimeoutMs > 0
      ? customTimeoutMs
      : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let onCallerAbort: (() => void) | null = null;

  if (callerSignal) {
    onCallerAbort = () => {
      const reason = 'reason' in callerSignal ? (callerSignal as any).reason : undefined;
      if (reason !== undefined) {
        try {
          controller.abort(reason);
        } catch {
          controller.abort();
        }
      } else {
        controller.abort();
      }
    };
    if (typeof callerSignal.addEventListener === 'function') {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    } else {
      (callerSignal as any).onabort = onCallerAbort;
    }
  }

  let response: Response;
  let responseText = '';

  try {
    response = await fetch(fullUrl, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (err: any) {
    if (timedOut) {
      const seconds = Math.round(timeoutMs / 1000);
      const timeStr = seconds > 0 ? `${seconds}s` : `${timeoutMs}ms`;
      throw {
        message: `Request timed out (${timeStr}). If the server was sleeping, please retry.`,
        status: 0,
      } as ApiError;
    }

    if (callerSignal?.aborted) {
      throw {
        message: 'Request was cancelled',
        status: 0,
      } as ApiError;
    }

    const errorMsg = err?.message || 'Network request failed';
    const isConnRefused = errorMsg.includes('Failed to connect') || errorMsg.includes('Network request failed');
    throw {
      message: isConnRefused
        ? `Cannot connect to server at ${baseUrl}. Ensure backend is running and reachable.`
        : errorMsg,
      status: 0,
    } as ApiError;
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal && onCallerAbort) {
      if (typeof callerSignal.removeEventListener === 'function') {
        callerSignal.removeEventListener('abort', onCallerAbort);
      } else if ((callerSignal as any).onabort === onCallerAbort) {
        (callerSignal as any).onabort = null;
      }
    }
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
