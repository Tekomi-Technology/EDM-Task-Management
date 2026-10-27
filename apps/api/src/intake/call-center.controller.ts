import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callCenterCheckResultSchema,
  callCenterComplaintSchema,
  networkReportSchema,
  reasonSchema,
  type CallCenterCheckResult,
  type CallCenterComplaint,
  type NetworkReport,
  type Reason
} from '../contract';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody } from '../common/zod';
import { TicketsQuery } from '../tickets/tickets.query';
import { CallCenterService, type IntakeTicketView } from './call-center.service';

/** API for the Call Center system. Authenticate with the `call-center-system` client (client credentials). */
@ApiTags('intake: call center')
@ApiBearerAuth()
@Controller('intake/call-center')
@Roles('integration_call_center')
export class CallCenterController {
  constructor(
    private readonly service: CallCenterService,
    private readonly query: TicketsQuery
  ) {}

  @Post('complaints')
  @ApiOperation({
    summary: 'Send a technical complaint',
    description:
      'Creates a ticket (201). Sending the same externalRef again returns the existing ticket (200).'
  })
  @ApiZodBody(callCenterComplaintSchema)
  async complaint(
    @ZodBody(callCenterComplaintSchema) body: CallCenterComplaint,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.service.receiveComplaint(body, user);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Post('network-reports')
  @ApiOperation({
    summary: 'Report a network problem from the public (800 145 145)',
    description:
      'Creates a network ticket for the team covering the place (201); the same externalRef again returns it (200).'
  })
  @ApiZodBody(networkReportSchema)
  async networkReport(
    @ZodBody(networkReportSchema) body: NetworkReport,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.service.receiveNetworkReport(body, user);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get('planned-outages')
  @ApiOperation({ summary: 'Planned power cuts from now on, to answer callers' })
  plannedOutages() {
    return this.query.plannedOutages();
  }

  @Get('tickets/:externalRef')
  @ApiOperation({ summary: 'Current status of a ticket, by the Call Center reference' })
  status(@Param('externalRef') externalRef: string): Promise<IntakeTicketView> {
    return this.service.status(externalRef);
  }

  @Post('tickets/:externalRef/check-result')
  @ApiOperation({
    summary: 'Result of calling the customer back',
    description:
      '"fixed" closes the ticket; "not_fixed" reopens it for the team manager to assign again. Only for resolved tickets.'
  })
  @ApiZodBody(callCenterCheckResultSchema)
  checkResult(
    @Param('externalRef') externalRef: string,
    @ZodBody(callCenterCheckResultSchema) body: CallCenterCheckResult,
    @CurrentUser() user: AuthUser
  ): Promise<IntakeTicketView> {
    return this.service.checkResult(externalRef, body, user);
  }

  @Post('tickets/:externalRef/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a ticket',
    description: 'For a withdrawn request or a duplicate. Not possible once the ticket is closed.'
  })
  @ApiZodBody(reasonSchema)
  cancel(
    @Param('externalRef') externalRef: string,
    @ZodBody(reasonSchema) body: Reason,
    @CurrentUser() user: AuthUser
  ): Promise<IntakeTicketView> {
    return this.service.cancel(externalRef, body, user);
  }
}
