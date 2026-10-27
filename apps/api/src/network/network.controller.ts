import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  linkTicketsSchema,
  notifyCustomersSchema,
  plannedWorkQuerySchema,
  plannedWorkSchema,
  setTeamSchema,
  type IncidentSummary,
  type PlannedWork,
  type PlannedWorkItem,
  type PlannedWorkQuery,
  type TicketDetail
} from '@edm/shared';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { TicketsQuery } from '../tickets/tickets.query';
import { TicketsService } from '../tickets/tickets.service';

const incidentViewSchema = z.object({
  view: z.enum(['open', 'recent']).default('open'),
  areaId: z.string().uuid().optional()
});
const OFFICE = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team'] as const;

/** Network incidents (from the NMS and public reports) and planned network work. */
@ApiTags('network')
@ApiBearerAuth()
@Controller()
export class NetworkController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly query: TicketsQuery
  ) {}

  @Get('incidents')
  @Roles(...OFFICE)
  incidents(
    @CurrentUser() user: AuthUser,
    @ZodQuery(incidentViewSchema) q: z.infer<typeof incidentViewSchema>
  ): Promise<IncidentSummary[]> {
    return this.query.incidents(user, q.view, q.areaId);
  }

  /** NOC confirms it has seen the incident. */
  @Post('tickets/:id/acknowledge')
  @HttpCode(200)
  @Roles('noc', 'admin', 'technical_manager')
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.tickets.acknowledge(id, user);
    return this.query.detail(id, user);
  }

  /** Customer tickets caused by this incident: nobody else is sent, and they close with it. */
  @Post('incidents/:id/link')
  @HttpCode(200)
  @Roles('noc', 'admin', 'technical_manager', 'team_manager')
  @ApiZodBody(linkTicketsSchema)
  async link(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(linkTicketsSchema) body: z.infer<typeof linkTicketsSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.tickets.link(id, body.ticketIds, user, true);
    return this.query.detail(id, user);
  }

  @Post('incidents/:id/unlink')
  @HttpCode(200)
  @Roles('noc', 'admin', 'technical_manager', 'team_manager')
  @ApiZodBody(linkTicketsSchema)
  async unlink(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(linkTicketsSchema) body: z.infer<typeof linkTicketsSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.tickets.link(id, body.ticketIds, user, false);
    return this.query.detail(id, user);
  }

  @Post('incidents/:id/notify-customers')
  @HttpCode(200)
  @Roles('noc', 'admin', 'technical_manager')
  @ApiZodBody(notifyCustomersSchema)
  async notifyCustomers(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(notifyCustomersSchema) body: z.infer<typeof notifyCustomersSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<{ sent: number }> {
    await this.query.detail(id, user);
    return { sent: await this.tickets.notifyLinkedCustomers(id, user, body.message) };
  }

  /** Put a ticket (e.g. one outside every area) in a team; it is then assigned like a new ticket. */
  @Post('tickets/:id/team')
  @HttpCode(200)
  @Roles('noc', 'admin', 'technical_manager')
  @ApiZodBody(setTeamSchema)
  async setTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setTeamSchema) body: z.infer<typeof setTeamSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.tickets.setTeam(id, body.teamId, user);
    return this.query.detail(id, user);
  }

  @Get('planned-work')
  @Roles(...OFFICE)
  plannedWork(
    @CurrentUser() user: AuthUser,
    @ZodQuery(plannedWorkQuerySchema) q: PlannedWorkQuery
  ): Promise<PlannedWorkItem[]> {
    return this.query.plannedWork(user, q.from, q.to, q.areaId);
  }

  /** The network team plans maintenance or a network change; the team manager then assigns it. */
  @Post('planned-work')
  @Roles('network_team', 'noc', 'admin', 'technical_manager')
  @ApiZodBody(plannedWorkSchema)
  async createPlannedWork(
    @ZodBody(plannedWorkSchema) body: PlannedWork,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    const start = new Date(body.scheduledStart);
    const end = new Date(body.scheduledEnd);
    const created = await this.tickets.create(
      {
        type: 'planned_work',
        source: 'network_team',
        externalRef: null,
        problemType: body.kind,
        priority: 3,
        slaMinutes: Math.round((end.getTime() - Date.now()) / 60_000),
        title: body.title,
        description: body.description ?? body.title,
        customerId: null,
        customerPhone: null,
        location: body.location ?? null,
        teamId: body.teamId,
        autoAssign: false,
        elementName: body.element,
        scheduledStart: start,
        scheduledEnd: end,
        outage: body.outage,
        customersAffected: body.customersAffected ?? null
      },
      user
    );
    return this.query.detail(created.id, user);
  }
}
