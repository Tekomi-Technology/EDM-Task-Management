import { Global, Module } from '@nestjs/common';
import { IdentityAdmin, KeycloakAdmin } from '../admin/identity-admin';
import { IntegrationDocsService } from './integration-docs';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/** Global: the notifications module logs its deliveries here. */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationDocsService,
    { provide: IdentityAdmin, useClass: KeycloakAdmin }
  ],
  exports: [IntegrationsService]
})
export class IntegrationsModule {}
