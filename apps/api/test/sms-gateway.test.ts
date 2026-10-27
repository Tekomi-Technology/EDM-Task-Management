import { describe, expect, it } from 'vitest';
import { PermanentDeliveryError } from '../src/notifications/delivery-error';
import { normalizePhone } from '../src/notifications/phone';
import { HttpSmsSender } from '../src/notifications/sms-sender';
import { parseOccurredAt } from '../src/tickets/occurred-at';
import { mockServer } from './mock-server';

const PORT = 59872;
const base = {
  SMS_HTTP_URL: `http://localhost:${PORT}/send`,
  SMS_HTTP_METHOD: 'POST' as const,
  SMS_HTTP_CONTENT_TYPE: 'json' as const,
  SMS_HTTP_BODY: '{"to":"{{to}}","from":"{{from}}","text":"{{text}}"}',
  SMS_HTTP_HEADERS: { Authorization: 'Bearer test-key' },
  SMS_HTTP_SUCCESS_TEXT: undefined,
  SMS_HTTP_TIMEOUT_MS: 2000,
  SMS_SENDER_ID: 'EDM',
  SMS_DEFAULT_COUNTRY_CODE: '258'
};

describe('phone numbers', () => {
  it('turns the usual ways of writing a Mozambican number into +258…', () => {
    for (const raw of ['84 123 4567', '841234567', '+258 84-123-4567', '00258841234567', '258841234567']) {
      expect(normalizePhone(raw)).toBe('+258841234567');
    }
    expect(normalizePhone('+351 912 345 678')).toBe('+351912345678');
  });
  it('rejects things that are not phone numbers', () => {
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('12')).toBeNull();
  });
});

describe('generic HTTP SMS gateway', () => {
  it('sends JSON with the configured headers, escaping the text safely', async () => {
    const gw = await mockServer(PORT, () => ({ status: 200, body: '{"ok":true}' }));
    try {
      await new HttpSmsSender(base).send('84 123 4567', 'Pedido "TK-26-00001" – técnico a caminho');
      const [req] = gw.received;
      expect(req.method).toBe('POST');
      expect(req.headers.authorization).toBe('Bearer test-key');
      expect(req.headers['content-type']).toBe('application/json');
      expect(JSON.parse(req.body)).toEqual({
        to: '+258841234567',
        from: 'EDM',
        text: 'Pedido "TK-26-00001" – técnico a caminho'
      });
    } finally {
      await gw.close();
    }
  });

  it('supports form bodies and numbers without the plus sign', async () => {
    const gw = await mockServer(PORT, () => ({ status: 200, body: 'OK' }));
    try {
      await new HttpSmsSender({
        ...base,
        SMS_HTTP_CONTENT_TYPE: 'form',
        SMS_HTTP_BODY: 'msisdn={{to_digits}}&sender={{from}}&message={{text}}'
      }).send('+258841234567', 'Olá & obrigado');
      const params = new URLSearchParams(gw.received[0]!.body);
      expect(Object.fromEntries(params)).toEqual({
        msisdn: '258841234567',
        sender: 'EDM',
        message: 'Olá & obrigado'
      });
    } finally {
      await gw.close();
    }
  });

  it('supports gateways that take everything in the address (GET)', async () => {
    const gw = await mockServer(PORT, () => ({ status: 200, body: 'OK' }));
    try {
      await new HttpSmsSender({
        ...base,
        SMS_HTTP_METHOD: 'GET',
        SMS_HTTP_URL: `http://localhost:${PORT}/api?to={{to}}&text={{text}}`
      }).send('841234567', 'a b');
      expect(gw.received[0]!.method).toBe('GET');
      expect(gw.received[0]!.url).toBe('/api?to=%2B258841234567&text=a%20b');
    } finally {
      await gw.close();
    }
  });

  it('does not retry what the gateway refuses (4xx) or a bad number, but retries server errors', async () => {
    let status = 400;
    const gw = await mockServer(PORT, () => ({ status, body: '{"error":"invalid"}' }));
    const sender = new HttpSmsSender(base);
    try {
      await expect(sender.send('841234567', 'x')).rejects.toBeInstanceOf(PermanentDeliveryError);
      await expect(sender.send('not a number', 'x')).rejects.toBeInstanceOf(PermanentDeliveryError);
      status = 503;
      const err = await sender.send('841234567', 'x').catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PermanentDeliveryError);
      status = 429;
      expect(await sender.send('841234567', 'x').catch((e: Error) => e)).not.toBeInstanceOf(
        PermanentDeliveryError
      );
    } finally {
      await gw.close();
    }
  });

  it('treats a 200 without the expected confirmation as a failure, and gives up waiting after the timeout', async () => {
    let delayMs = 0;
    const gw = await mockServer(PORT, () => ({ status: 200, body: '{"status":"ERROR"}', delayMs }));
    try {
      const strict = new HttpSmsSender({ ...base, SMS_HTTP_SUCCESS_TEXT: '"status":"OK"' });
      await expect(strict.send('841234567', 'x')).rejects.toThrow('did not confirm');
      delayMs = 500;
      const impatient = new HttpSmsSender({ ...base, SMS_HTTP_TIMEOUT_MS: 100 });
      await expect(impatient.send('841234567', 'x')).rejects.toThrow('did not answer');
    } finally {
      await gw.close();
    }
  });
});

describe('time of actions done offline', () => {
  const now = Date.parse('2026-10-27T10:00:00Z');
  it('keeps a believable earlier time', () => {
    expect(parseOccurredAt('2026-10-27T08:15:00Z', now)?.toISOString()).toBe('2026-10-27T08:15:00.000Z');
  });
  it('ignores missing, unreadable, future, very old or practically current times', () => {
    expect(parseOccurredAt(undefined, now)).toBeUndefined();
    expect(parseOccurredAt('yesterday', now)).toBeUndefined();
    expect(parseOccurredAt('2026-10-27T11:00:00Z', now)).toBeUndefined();
    expect(parseOccurredAt('2026-10-01T10:00:00Z', now)).toBeUndefined();
    expect(parseOccurredAt('2026-10-27T09:59:30Z', now)).toBeUndefined();
  });
});
