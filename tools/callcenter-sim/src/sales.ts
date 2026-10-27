/**
 * Pretend Sales system: sends survey and connection requests and activations, and receives the webhooks.
 *
 *   pnpm sales survey <ref> "<name>" [phone]      ask for a survey (a shop in Matola Gare)
 *   pnpm sales connect <ref> <contractNo> [surveyRef]
 *   pnpm sales activate <ref> [no]                service activated (or "no": failed)
 *   pnpm sales status <ref>
 *   pnpm sales webhook                            listen on :59091 and print events (set SALES_WEBHOOK_URL to it)
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { call, salesToken } from './client.js';

async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<void> {
  const res = await call(await salesToken(), method, path, body);
  console.log(res.status, JSON.stringify(res.body, null, 2));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'survey' && args[0]) {
    return send('POST', '/intake/sales/survey-requests', {
      externalRef: args[0],
      customer: {
        fullName: args[1] ?? 'Loja Esperança',
        phone: args[2] ?? '+258849000001',
        address: 'Matola Gare, Rua 4',
        location: { lat: -25.915, lng: 32.455 }
      },
      premises: 'shop',
      supply: 'single_phase',
      requestedLoadKw: 6
    });
  }
  if (command === 'connect' && args[0] && args[1]) {
    return send('POST', '/intake/sales/connection-requests', {
      externalRef: args[0],
      contractNo: args[1],
      surveyRef: args[2],
      supply: 'single_phase',
      ...(args[2]
        ? {}
        : {
            customer: {
              fullName: 'New customer',
              phone: '+258849000002',
              address: 'Matola, Liberdade',
              location: { lat: -25.94, lng: 32.47 }
            }
          })
    });
  }
  if (command === 'activate' && args[0]) {
    return send('POST', `/intake/sales/connections/${args[0]}/activation`, {
      activated: args[1] !== 'no',
      note: args[1] === 'no' ? 'Meter not registered in billing' : undefined
    });
  }
  if (command === 'status' && args[0]) return send('GET', `/intake/sales/requests/${args[0]}`);
  if (command === 'webhook') {
    const secret = process.env.SALES_WEBHOOK_SECRET ?? 'sales-webhook-dev-secret';
    const port = Number(process.env.SALES_WEBHOOK_PORT ?? 59091);
    createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
        const valid = req.headers['x-edm-signature'] === expected;
        console.log(
          `\n${new Date().toLocaleTimeString()} ${req.headers['x-edm-event']} · signature ${valid ? 'valid' : 'INVALID'}`
        );
        console.log(JSON.stringify(JSON.parse(body || '{}'), null, 2));
        res.writeHead(valid ? 200 : 401).end();
      });
    }).listen(port, () => console.log(`Pretend Sales webhook on http://localhost:${port}/events`));
    return;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
