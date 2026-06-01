import type { AuthResponse } from './types';

const tokenKey = 'mebius.accessToken';
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

export function getAccessToken(): string | null {
  return localStorage.getItem(tokenKey);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(tokenKey, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(tokenKey);
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (apiBase.startsWith('http')) {
    return `${apiBase.replace(/\/+$/, '')}${normalizedPath}`;
  }
  return `${apiBase}${normalizedPath}`;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAccessToken();
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: jsonBody({ email, password }),
  });
}

export async function register(input: {
  email: string;
  name: string;
  password: string;
  adminInviteCode?: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: jsonBody(input),
  });
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Request failed with HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (Array.isArray(payload.message)) return payload.message.join(', ');
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
  } catch {
    return text;
  }
  return text;
}
