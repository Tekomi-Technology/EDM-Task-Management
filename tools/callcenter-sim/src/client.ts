import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const API_URL = `${process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}`}/api`;
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:58080';
const REALM = process.env.KEYCLOAK_REALM ?? 'edm';
const TOKEN_URL = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

async function token(form: Record<string, string>): Promise<string> {
  const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(form) });
  if (!res.ok) throw new Error(`Keycloak refused the sign-in (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Token for the Call Center system (client credentials), as the real Call Center would get it. */
export function callCenterToken(): Promise<string> {
  return token({
    grant_type: 'client_credentials',
    client_id: process.env.CALLCENTER_CLIENT_ID ?? 'call-center-system',
    client_secret: process.env.CALLCENTER_CLIENT_SECRET ?? 'call-center-dev-secret'
  });
}

/** Token for the Sales system (client credentials). */
export function salesToken(): Promise<string> {
  return token({
    grant_type: 'client_credentials',
    client_id: process.env.SALES_CLIENT_ID ?? 'sales-system',
    client_secret: process.env.SALES_CLIENT_SECRET ?? 'sales-dev-secret'
  });
}

/** Token for EDM's stock management system (client credentials). */
export function stockToken(): Promise<string> {
  return token({
    grant_type: 'client_credentials',
    client_id: process.env.STOCK_CLIENT_ID ?? 'stock-system',
    client_secret: process.env.STOCK_CLIENT_SECRET ?? 'stock-dev-secret'
  });
}

/** Token for the network management system (client credentials), as the real NMS would get it. */
export function nmsToken(): Promise<string> {
  return token({
    grant_type: 'client_credentials',
    client_id: process.env.NMS_CLIENT_ID ?? 'nms-system',
    client_secret: process.env.NMS_CLIENT_SECRET ?? 'nms-dev-secret'
  });
}

/** Token for a sample user through the dev-only client; used by the end-to-end script. */
export function userToken(username: string, password = 'Edm@2026'): Promise<string> {
  return token({ grant_type: 'password', client_id: 'edm-dev-cli', username, password });
}

/** Tries to sign in and returns Keycloak's refusal message, or null when the sign-in works. */
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
