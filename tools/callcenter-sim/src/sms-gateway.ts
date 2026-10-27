/**
 * A pretend SMS gateway for development: prints every SMS the API sends and answers like a real gateway.
 * Run `pnpm sms-gateway`, then start the API with:
 *   SMS_PROVIDER=http SMS_HTTP_URL=http://localhost:59090/send
 * Optional: SMS_GATEWAY_FAIL=1 answers 503 (to watch retries), SMS_GATEWAY_REJECT=1 answers 400 (no retry).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.SMS_GATEWAY_PORT ?? 59090);
let count = 0;

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk: Buffer) => (body += chunk.toString()));
  req.on('end', () => {
    count += 1;
    const when = new Date().toLocaleTimeString();
    const fields = req.headers['content-type']?.includes('json')
      ? (JSON.parse(body || '{}') as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(body || (req.url?.split('?')[1] ?? '')));
    console.log(`#${count} ${when} ${req.method} ${req.url}`);
    console.log(`   to: ${fields.to ?? fields.msisdn ?? '?'}  from: ${fields.from ?? fields.sender ?? '?'}`);
    console.log(`   ${fields.text ?? fields.message ?? body}`);
    if (req.headers.authorization) console.log(`   auth: ${req.headers.authorization}`);

    const status = process.env.SMS_GATEWAY_REJECT ? 400 : process.env.SMS_GATEWAY_FAIL ? 503 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { status: 'OK', id: `msg-${count}` } : { status: 'ERROR' }));
  });
}).listen(PORT, () => console.log(`Pretend SMS gateway listening on http://localhost:${PORT}/send`));
