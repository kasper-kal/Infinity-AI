/**
 * API Client - Re-exports the generated API client from @workspace/api-client-react
 * Provides a clean import path for components
 */

// Re-export all generated API functions and types
export * from '@workspace/api-client-react';

// Create a simple fetch-based API client for non-React contexts
import { customFetch, setBaseUrl, setAuthTokenGetter, type AuthTokenGetter } from '@workspace/api-client-react';

let baseUrl = '/api/v1';

export function setApiBaseUrl(url: string) {
  baseUrl = url;
  setBaseUrl(url);
}

export function setApiAuthTokenGetter(getter: AuthTokenGetter) {
  setAuthTokenGetter(getter);
}

interface ApiRequestInit extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function apiRequest<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  const { params, headers, ...rest } = init;

  let fullUrl = `${baseUrl}${url}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    const query = searchParams.toString();
    if (query) {
      fullUrl += `${fullUrl.includes('?') ? '&' : '?'}${query}`;
    }
  }

  const response = await customFetch(fullUrl, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(url: string, init?: Omit<ApiRequestInit, 'method' | 'body'>) =>
    apiRequest<T>(url, { ...init, method: 'GET' }),
  post: <T>(url: string, body?: unknown, init?: Omit<ApiRequestInit, 'method'>) =>
    apiRequest<T>(url, { ...init, method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(url: string, body?: unknown, init?: Omit<ApiRequestInit, 'method'>) =>
    apiRequest<T>(url, { ...init, method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(url: string, body?: unknown, init?: Omit<ApiRequestInit, 'method'>) =>
    apiRequest<T>(url, { ...init, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(url: string, init?: Omit<ApiRequestInit, 'method' | 'body'>) =>
    apiRequest<T>(url, { ...init, method: 'DELETE' }),
};

export type { AuthTokenGetter };
export { apiRequest };