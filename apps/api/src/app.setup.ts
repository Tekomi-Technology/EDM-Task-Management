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
  const http = app.getHttpAdapter().getInstance() as { disable: (setting: string) => void };
  http.disable('x-powered-by');
  app.use(securityHeaders(env.NODE_ENV === 'production'));
  app.setGlobalPrefix('api');
  app.use('/api/intake', integrationLog(app.get(IntegrationsService)));
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: false });
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('EDM Task Management API')
    .setDescription(
      'Technical ticket system for Electricidade de Moçambique. Users sign in with Keycloak; ' +
        'the Call Center system uses the client-credentials grant with the `call-center-system` client.'
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
