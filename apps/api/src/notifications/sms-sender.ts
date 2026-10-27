import { Injectable, Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import { PermanentDeliveryError } from './delivery-error';
import { normalizePhone } from './phone';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  /** Resolves when the gateway accepted the message; throws PermanentDeliveryError when retrying cannot help. */
  send(to: string, body: string): Promise<void>;
}

/** Development stand-in: only writes the message to the log. */
@Injectable()
export class LogSmsSender implements SmsSender {
  private readonly logger = new Logger('Sms');

  async send(to: string, body: string): Promise<void> {
    this.logger.log(`SMS to ${to}: ${body}`);
  }
}

type HttpSmsConfig = Pick<
  Env,
  | 'SMS_HTTP_URL'
  | 'SMS_HTTP_METHOD'
  | 'SMS_HTTP_CONTENT_TYPE'
  | 'SMS_HTTP_BODY'
  | 'SMS_HTTP_HEADERS'
  | 'SMS_HTTP_SUCCESS_TEXT'
  | 'SMS_HTTP_TIMEOUT_MS'
  | 'SMS_SENDER_ID'
  | 'SMS_DEFAULT_COUNTRY_CODE'
>;

/** Fills {{to}}, {{to_digits}}, {{from}} and {{text}}, encoding each value for where it goes. */
function fill(template: string, values: Record<string, string>, encode: (v: string) => string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? encode(values[key]!) : match
  );
}

const jsonString = (v: string) => JSON.stringify(v).slice(1, -1);

/**
 * Sends SMS through any HTTP gateway (Movitel, Vodacom, Tmcel or an aggregator) described entirely by settings,
 * so the provider can be chosen or changed without code changes. 4xx answers are not retried; 5xx and
 * timeouts are.
 */
export class HttpSmsSender implements SmsSender {
  constructor(private readonly config: HttpSmsConfig) {}

  async send(to: string, body: string): Promise<void> {
    const c = this.config;
    const phone = normalizePhone(to, c.SMS_DEFAULT_COUNTRY_CODE);
    if (!phone) throw new PermanentDeliveryError(`Not a phone number: ${to}`);
    const values = { to: phone, to_digits: phone.slice(1), from: c.SMS_SENDER_ID, text: body };

    const url = fill(c.SMS_HTTP_URL!, values, encodeURIComponent);
    const headers: Record<string, string> = { ...c.SMS_HTTP_HEADERS };
    let payload: string | undefined;
    if (c.SMS_HTTP_METHOD === 'POST') {
      if (c.SMS_HTTP_CONTENT_TYPE === 'json') {
        payload = fill(c.SMS_HTTP_BODY, values, jsonString);
        headers['Content-Type'] ??= 'application/json';
      } else {
        payload = fill(c.SMS_HTTP_BODY, values, encodeURIComponent);
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: c.SMS_HTTP_METHOD,
        headers,
        body: payload,
        signal: AbortSignal.timeout(c.SMS_HTTP_TIMEOUT_MS)
      });
    } catch (err) {
      throw new Error(`SMS gateway did not answer: ${(err as Error).message}`);
    }
    const answer = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new PermanentDeliveryError(`SMS gateway refused the message (${res.status}): ${answer}`);
    }
    if (!res.ok) throw new Error(`SMS gateway error (${res.status}): ${answer}`);
    if (c.SMS_HTTP_SUCCESS_TEXT && !answer.includes(c.SMS_HTTP_SUCCESS_TEXT)) {
      throw new Error(`SMS gateway did not confirm the message: ${answer}`);
    }
  }
}

export function createSmsSender(env: Env): SmsSender {
  return env.SMS_PROVIDER === 'http' ? new HttpSmsSender(env) : new LogSmsSender();
}
