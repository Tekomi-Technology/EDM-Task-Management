import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from './config/env';
import { integrationLog } from './integrations/integration-log';
import { IntegrationDocsService, type OpenApiDocument } from './integrations/integration-docs';
import { IntegrationsService } from './integrations/integrations.service';

/** Shared by main.ts and the tests so both run the same app configuration. */
export function configureApp(app: INestApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  const http = app.getHttpAdapter().getInstance() as {
    disable: (setting: string) => void;
    set: (setting: string, value: unknown) => void;
  };
  http.disable('x-powered-by');
  // Behind nginx (and Docker's network): the visitor's own address comes from X-Forwarded-For, so limits on
  // sign-in attempts count each visitor, not the proxy.
  http.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(securityHeaders(env.NODE_ENV === 'production'));
  app.setGlobalPrefix('api');
  app.use('/api/intake', integrationLog(app.get(IntegrationsService)));
  // Credentials: the web app's session cookie, when it runs on another address than the API (development).
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('EDM Task Management API')
    .setDescription(
      'Technical ticket system for Electricidade de Moçambique. People sign in at /api/auth/sign-in; ' +
        'the other EDM systems send an API key made in Settings → API keys (Authorization: Bearer <key>).'
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // The API documentation screen in the web app reads it too, also when the Swagger page is off.
  app.get(IntegrationDocsService).use(document as unknown as OpenApiDocument);
  if (env.API_DOCS ?? env.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, document);
}

/** The API only returns JSON and files: nothing may sniff, frame or cache what it sends. */
function securityHeaders(https: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cache-Control', 'no-store');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
