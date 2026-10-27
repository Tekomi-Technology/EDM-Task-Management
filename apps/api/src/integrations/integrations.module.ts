import { Global, Module } from '@nestjs/common';
import { IdentityAdmin, KeycloakAdmin } from '../admin/identity-admin';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/** Global: the notifications module logs its deliveries here. */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, { provide: IdentityAdmin, useClass: KeycloakAdmin }],
  exports: [IntegrationsService]
})
export class IntegrationsModule {}
