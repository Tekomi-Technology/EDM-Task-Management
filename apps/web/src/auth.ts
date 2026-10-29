import type { ApiError, SignInResult } from './types';
import { useSyncExternalStore } from 'react';

const API_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`;

/**
 * Signing in. The access token lives only in memory; the session itself is an httpOnly cookie the page cannot
 * read, sent only to /api/auth. On load the app asks /auth/refresh: a session that has not ended signs the
 * person in again without a password (for a week, Settings → Sign-in security).
 */
export type AuthState = 'loading' | 'signed-out' | 'must-change-password' | 'signed-in';

let state: AuthState = 'loading';
let token: string | null = null;
let expiresAt = 0;
let renewing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

/** The answer's error, as the API sends it. */
export class AuthError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

async function post(path: string, body: unknown, withToken = false): Promise<Response> {
  return fetch(`${API_URL}/auth/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(withToken && token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function failure(res: Response): Promise<AuthError> {
  const data = (await res.json().catch(() => null)) as ApiError | null;
  return new AuthError(
    data ?? { statusCode: res.status, code: 'NETWORK_ERROR', message: 'The server did not answer' }
  );
}

function accept(result: SignInResult): void {
  token = result.accessToken;
  expiresAt = Date.now() + result.expiresIn * 1000;
  setState(result.mustChangePassword ? 'must-change-password' : 'signed-in');
}

function forget(): void {
  token = null;
  expiresAt = 0;
  setState('signed-out');
}

/** A new access token from the session cookie; false when the session has ended. One request at a time. */
function renew(): Promise<boolean> {
  renewing ??= (async () => {
    try {
      const res = await post('refresh', {});
      if (!res.ok) {
        forget();
        return false;
      }
      accept((await res.json()) as SignInResult);
      return true;
    } catch {
      // Network down: keep the state; the next request tries again.
      return false;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/** Signs in again from the session cookie when there is one; otherwise shows the sign-in page. */
export async function initAuth(): Promise<void> {
  if (!(await renew()) && state === 'loading') setState('signed-out');
}

export async function signIn(username: string, password: string): Promise<void> {
  const res = await post('sign-in', { username, password, client: 'web' });
  if (!res.ok) throw await failure(res);
  accept((await res.json()) as SignInResult);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await post('change-password', { currentPassword, newPassword }, true);
  if (!res.ok) throw await failure(res);
  setState('signed-in');
}

/** A valid access token, renewed when it expires within 30 seconds. */
export async function accessToken(): Promise<string> {
  if (!token || expiresAt - Date.now() < 30_000) await renew();
  if (!token) throw new AuthError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in required' });
  return token;
}

/** Called by the API helper when the server refuses the token or asks for a new password. */
export function onAuthProblem(code: string): void {
  if (code === 'PASSWORD_CHANGE_REQUIRED') setState('must-change-password');
  else if (code === 'UNAUTHENTICATED' || code === 'ACCOUNT_DISABLED' || code === 'SESSION_ENDED') forget();
}

/** A token refused as expired is renewed once and the request sent again. */
export async function renewAfterExpiry(): Promise<boolean> {
  token = null;
  return renew();
}

export function signOut(): void {
  void post('sign-out', {})
    .catch(() => undefined)
    .finally(() => {
      forget();
      // A clean start: no screen keeps the previous person's data.
      window.location.assign('/');
    });
}
