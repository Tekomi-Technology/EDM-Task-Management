import { createHmac } from 'node:crypto';
import { PermanentDeliveryError } from './delivery-error';

/**
 * Posts an event to another system. The body is signed with the shared secret (X-EDM-Signature: sha256=<hex>),
 * so the receiver can check it came from EDM Tasks. 4xx answers are not retried; 5xx and timeouts are.
 */
export async function sendWebhook(url: string, body: string, secret?: string): Promise<void> {
  const event = (JSON.parse(body) as { event?: string }).event ?? 'event';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-EDM-Event': event };
  if (secret)
    headers['X-EDM-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`Webhook did not answer: ${(err as Error).message}`);
  }
  if (res.ok) return;
  const text = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new PermanentDeliveryError(`Webhook refused (${res.status}): ${text}`);
  }
  throw new Error(`Webhook error (${res.status}): ${text}`);
}
