import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  areaFilterSchema,
  type AreaFilter,
  activationResultSchema,
  connectionRequestSchema,
  officeConnectionSchema,
  officeSurveySchema,
  surveyRequestSchema,
  type ActivationResult,
  type ConnectionRequest,
  type NewCustomerCard,
  type OfficeConnection,
  type OfficeSurvey,
  type SurveyRequest
} from '../contract';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { SalesService, type SalesRequestView } from './sales.service';

/**
 * API for the Sales system. Authenticate with the `sales-system` client (client credentials). Results are also
 * posted to SALES_WEBHOOK_URL as they happen: survey_completed, connection_installed, request_cancelled.
 */
@ApiTags('intake: sales')
@ApiBearerAuth()
@Controller('intake/sales')
@Roles('integration_sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post('survey-requests')
  @ApiOperation({
    summary: 'Ask for a technical survey',
    description: '201 created; the same externalRef again returns it (200).'
  })
  @ApiZodBody(surveyRequestSchema)
  async survey(
    @ZodBody(surveyRequestSchema) body: SurveyRequest,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.sales.receiveSurvey(body, user);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Post('connection-requests')
  @ApiOperation({
    summary: 'Contract signed: ask for the connection',
    description: 'Give surveyRef when it follows a survey.'
  })
  @ApiZodBody(connectionRequestSchema)
  async connection(
    @ZodBody(connectionRequestSchema) body: ConnectionRequest,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.sales.receiveConnection(body, user);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get('requests/:externalRef')
  @ApiOperation({ summary: 'Status, survey result and installation of a request' })
  status(@Param('externalRef') externalRef: string): Promise<SalesRequestView> {
    return this.sales.status(externalRef);
  }

  @Post('connections/:externalRef/activation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Service activated (or not) after installation',
    description:
      'activated=true closes the connection and tells the customer; false sends it back to the team.'
  })
  @ApiZodBody(activationResultSchema)
  activation(
    @Param('externalRef') externalRef: string,
    @ZodBody(activationResultSchema) body: ActivationResult,
    @CurrentUser() user: AuthUser
  ): Promise<SalesRequestView> {
    return this.sales.activation(externalRef, body, user);
  }
}

/** The New customers board (W10). */
@ApiTags('new customers')
@ApiBearerAuth()
@Controller('new-customers')
@Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
export class NewCustomersController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  board(
    @CurrentUser() user: AuthUser,
    @ZodQuery(areaFilterSchema) q: AreaFilter
  ): Promise<NewCustomerCard[]> {
    return this.sales.board(user, q.areaId);
  }

  /** New ticket screen: a survey without the Sales system (nothing is sent back to Sales). */
  @Post('surveys')
  @Roles('admin', 'technical_manager')
  @ApiZodBody(officeSurveySchema)
  survey(
    @ZodBody(officeSurveySchema) body: OfficeSurvey,
    @CurrentUser() user: AuthUser
  ): Promise<{ id: string; code: string }> {
    return this.sales.officeSurvey(body, user).then(({ id, code }) => ({ id, code }));
  }

  /** New ticket screen: a connection without the Sales system; the Call Center checks it, the office closes it. */
  @Post('connections')
  @Roles('admin', 'technical_manager')
  @ApiZodBody(officeConnectionSchema)
  connection(
    @ZodBody(officeConnectionSchema) body: OfficeConnection,
    @CurrentUser() user: AuthUser
  ): Promise<{ id: string; code: string }> {
    return this.sales.officeConnection(body, user).then(({ id, code }) => ({ id, code }));
  }
}
