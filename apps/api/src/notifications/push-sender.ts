import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import { PermanentDeliveryError } from './delivery-error';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSender {
  /** Resolves when Expo accepted the message; throws PermanentDeliveryError when retrying cannot help. */
  send(message: PushMessage): Promise<void>;
}

export class LogPushSender implements PushSender {
  private readonly logger = new Logger('Push');

  async send(m: PushMessage): Promise<void> {
    this.logger.log(`Push to ${m.to}: ${m.title} – ${m.body}`);
  }
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Errors from Expo that will not go away by trying again. */
const PERMANENT = ['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig', 'MismatchSenderId'];

/** Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushSender implements PushSender {
  constructor(private readonly config: Pick<Env, 'EXPO_PUSH_URL' | 'EXPO_ACCESS_TOKEN'>) {}

  async send(m: PushMessage): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.config.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.config.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${this.config.EXPO_ACCESS_TOKEN}` }
            : {})
        },
        body: JSON.stringify([
          {
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
            channelId: 'jobs'
          }
        ]),
        signal: AbortSignal.timeout(10_000)
      });
    } catch (err) {
      throw new Error(`Expo push service did not answer: ${(err as Error).message}`);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new PermanentDeliveryError(`Expo refused the push (${res.status}): ${text.slice(0, 300)}`);
      }
      throw new Error(`Expo push error (${res.status}): ${text.slice(0, 300)}`);
    }
    const ticket = (JSON.parse(text) as { data?: ExpoTicket[] }).data?.[0];
    if (ticket?.status === 'ok') return;
    const code = ticket?.details?.error;
    const reason = `Expo push failed: ${code ?? ''} ${ticket?.message ?? text.slice(0, 300)}`.trim();
    if (code && PERMANENT.includes(code)) throw new PermanentDeliveryError(reason, code);
    throw new Error(reason);
  }
}

export function createPushSender(env: Env): PushSender {
  return env.PUSH_PROVIDER === 'expo' ? new ExpoPushSender(env) : new LogPushSender();
}
