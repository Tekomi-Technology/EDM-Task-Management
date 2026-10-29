import { Global, Module } from '@nestjs/common';
import { IntegrationDocsService } from './integration-docs';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/** Global: the notifications module logs its deliveries here. */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationDocsService],
  exports: [IntegrationsService]
})
export class IntegrationsModule {}
