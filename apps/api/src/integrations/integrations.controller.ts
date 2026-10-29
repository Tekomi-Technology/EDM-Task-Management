import { Controller, Get, HttpCode, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  INTEGRATION_SYSTEMS,
  type IntegrationCallView,
  type IntegrationDocs,
  type IntegrationSystem,
  type IntegrationsOverview,
  type IntegrationTestResult
} from '../contract';
import { Roles } from '../auth/decorators';
import { IntegrationDocsService } from './integration-docs';
import { IntegrationsService } from './integrations.service';

const system = new ParseEnumPipe(Object.fromEntries(INTEGRATION_SYSTEMS.map((s) => [s, s])));

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
@Roles('admin', 'technical_manager')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly docs: IntegrationDocsService
  ) {}

  @Get()
  overview(): Promise<IntegrationsOverview> {
    return this.integrations.overview();
  }

  /** "API documentation" in the admin area: what the other EDM systems can call, and the events EDM Tasks sends them. */
  @Get('docs')
  @Roles('admin')
  apiDocs(): IntegrationDocs {
    return this.docs.docs();
  }

  /** "View log": the last 100 requests or deliveries. */
  @Get(':system/calls')
  calls(@Param('system', system) s: IntegrationSystem): Promise<IntegrationCallView[]> {
    return this.integrations.calls(s);
  }

  @Post(':system/test')
  @HttpCode(200)
  test(@Param('system', system) s: IntegrationSystem): Promise<IntegrationTestResult> {
    return this.integrations.test(s);
  }
}
