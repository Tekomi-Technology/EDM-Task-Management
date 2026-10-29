import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const API_URL = `${process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}`}/api`;

/** The sample API keys of the other systems (loaded with the sample data); a server uses keys made in Settings. */
const DEV_KEYS = {
  call_center: 'edm_dev-call-center-key-000000000000',
  sales: 'edm_dev-sales-key-00000000000000000000',
  nms: 'edm_dev-nms-key-000000000000000000000000',
  stock: 'edm_dev-stock-key-0000000000000000000000'
};

/** The Call Center system's API key, as the real Call Center sends it. */
export async function callCenterToken(): Promise<string> {
  return process.env.CALL_CENTER_API_KEY ?? DEV_KEYS.call_center;
}

/** The Sales system's API key. */
export async function salesToken(): Promise<string> {
  return process.env.SALES_API_KEY ?? DEV_KEYS.sales;
}

/** EDM's stock management system's API key. */
export async function stockToken(): Promise<string> {
  return process.env.STOCK_API_KEY ?? DEV_KEYS.stock;
}

/** The network management system's API key. */
export async function nmsToken(): Promise<string> {
  return process.env.NMS_API_KEY ?? DEV_KEYS.nms;
}

/** Signs in like the phone app does; the answer as it comes. */
export async function signIn(
  username: string,
  password = 'Edm@2026'
): Promise<{ status: number; body: { accessToken?: string; mustChangePassword?: boolean; code?: string } }> {
  const res = await fetch(`${API_URL}/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, client: 'app' })
  });
  return { status: res.status, body: (await res.json()) as { accessToken?: string; code?: string } };
}

/** An access token for a sample person. */
export async function userToken(username: string, password = 'Edm@2026'): Promise<string> {
  const res = await signIn(username, password);
  if (!res.body.accessToken) throw new Error(`Sign-in refused (${res.status}): ${res.body.code}`);
  return res.body.accessToken;
}

/** Tries to sign in and returns the refusal message, or null when the sign-in works. */
export async function signInError(username: string, password = 'Edm@2026'): Promise<string | null> {
  try {
    await userToken(username, password);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { ...headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
