import type { ApiError } from './types';
import { accessToken, onAuthProblem, renewAfterExpiry } from './auth';
import { t } from './i18n';

const API_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`;

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
  retried = false
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data as ApiError | null)?.code;
    // The token ran out between the check and the answer: renew it and send the request once more.
    if (code === 'TOKEN_EXPIRED' && !retried && (await renewAfterExpiry())) return api<T>(path, init, true);
    if (code) onAuthProblem(code);
    throw new ApiRequestError(
      (data as ApiError | null) ?? {
        statusCode: res.status,
        code: 'NETWORK_ERROR',
        message: t('The server did not answer')
      }
    );
  }
  return data as T;
}

/** Downloads a file from the API (with the sign-in token) and hands it to the browser to save. */
export async function download(path: string, fileName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      data ?? { statusCode: res.status, code: 'NETWORK_ERROR', message: t('The server did not answer') }
    );
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
