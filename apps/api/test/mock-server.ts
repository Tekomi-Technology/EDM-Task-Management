import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

/** A tiny HTTP server standing in for an SMS gateway or Expo; `reply` decides each answer. */
export async function mockServer(
  port: number,
  reply: (req: Received) => { status: number; body: string; delayMs?: number }
): Promise<{ received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const r: Received = { method: req.method!, url: req.url!, headers: req.headers, body };
      received.push(r);
      const answer = reply(r);
      setTimeout(() => {
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(answer.body);
      }, answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
