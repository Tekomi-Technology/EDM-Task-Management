import type { IntegrationSystem } from '../contract';
import type { NextFunction, Request, Response } from 'express';
import type { IntegrationsService } from './integrations.service';

const SYSTEM_BY_PATH: Record<string, IntegrationSystem> = {
  'call-center': 'call_center',
  sales: 'sales',
  nms: 'nms',
  stock: 'stock'
};

/**
 * Express middleware for /api/intake: logs every request another system sends, with the answer it got (including
 * refused sign-ins, which never reach a controller) and how long it took.
 */
export function integrationLog(integrations: IntegrationsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const system = SYSTEM_BY_PATH[req.path.split('/')[1] ?? ''];
    if (!system) return next();
    const started = performance.now();
    res.on('finish', () => {
      // The route pattern (".../tickets/:ref/check-result") rather than the URL, so the log groups calls.
      const route = (req.route as { path?: string } | undefined)?.path?.replace(/^\/api/, '');
      void integrations.record({
        system,
        direction: 'in',
        operation: `${req.method} ${route ?? `/intake${req.path}`}`,
        statusCode: res.statusCode,
        ok: res.statusCode < 400,
        durationMs: performance.now() - started,
        error: res.statusCode < 400 ? null : ((res.locals.error as string | undefined) ?? null)
      });
    });
    next();
  };
}
