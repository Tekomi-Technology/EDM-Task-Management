import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  areaFilterSchema,
  assignTicketSchema,
  attachmentUploadSchema,
  dutySchema,
  reasonSchema,
  resolveTicketSchema,
  ticketNoteSchema,
  ticketListQuerySchema,
  type AreaFilter,
  type AssignTicket,
  type AttachmentUpload,
  type CurrentUser as CurrentUserView,
  type Duty,
  type Reason,
  type ResolveTicket,
  type Lookups,
  type Overview,
  type TicketCounts,
  type TicketDetail,
  type TicketMessage,
  type TicketNote,
  type TicketListQuery,
  type TicketStatus,
  type TicketSummary
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { OccurredAt } from './occurred-at';
import { TicketsQuery } from './tickets.query';
import { UsersService } from '../users/users.service';
import { TicketsService } from './tickets.service';

const noteSchema = z.object({ note: z.string().trim().max(1000).optional() });

@ApiTags('tickets')
@ApiBearerAuth()
@Controller()
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly query: TicketsQuery,
    private readonly users: UsersService
  ) {}

  /**
   * Field staff switch duty on when their shift starts; only staff on duty receive jobs automatically. Tickets of
   * the team that waited because nobody was on duty are given out then.
   */
  @Post('me/duty')
  @HttpCode(200)
  @Roles('field_staff')
  @ApiZodBody(dutySchema)
  async setDuty(@CurrentUser() user: AuthUser, @ZodBody(dutySchema) body: Duty): Promise<CurrentUserView> {
    await this.users.setDuty(user.userId!, body.onDuty);
    if (body.onDuty) await this.tickets.assignWaiting(user.teamId);
    return {
      id: user.userId!,
      username: user.username,
      fullName: user.fullName,
      roles: user.roles,
      teamId: user.teamId,
      teamName: await this.users.teamName(user.teamId),
      onDuty: body.onDuty
    };
  }

  @Get('tickets')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team', 'field_staff')
  list(
    @CurrentUser() user: AuthUser,
    @ZodQuery(ticketListQuerySchema) q: TicketListQuery
  ): Promise<{ items: TicketSummary[]; total: number }> {
    return this.query.list(user, q);
  }

  /** Number of tickets in each tab of the Tickets screen. Declared before tickets/:id so "counts" is not an id. */
  @Get('tickets/counts')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
  counts(@CurrentUser() user: AuthUser, @ZodQuery(areaFilterSchema) q: AreaFilter): Promise<TicketCounts> {
    return this.query.counts(user, q.areaId);
  }

  @Get('overview')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
  overview(@CurrentUser() user: AuthUser, @ZodQuery(areaFilterSchema) q: AreaFilter): Promise<Overview> {
    return this.query.overview(user, q.areaId);
  }

  /** Areas and teams, for the filters on the Tickets screen. */
  @Get('lookups')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
  lookups(): Promise<Lookups> {
    return this.query.lookups();
  }

  @Get('me/jobs')
  @Roles('field_staff')
  myJobs(@CurrentUser() user: AuthUser): Promise<TicketSummary[]> {
    return this.query.myJobs(user);
  }

  @Get('tickets/:id')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team', 'field_staff')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<TicketDetail> {
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/assign')
  @HttpCode(200)
  @Roles('team_manager', 'technical_manager', 'admin')
  @ApiZodBody(assignTicketSchema)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(assignTicketSchema) body: AssignTicket
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'assign', user, { assigneeId: body.assigneeId });
    return this.query.detail(id, user);
  }

  /** Takes the job back from whoever holds it, saying why; it goes to the next person of the team on duty. */
  @Post('tickets/:id/take-back')
  @HttpCode(200)
  @Roles('team_manager', 'technical_manager', 'admin')
  @ApiZodBody(reasonSchema)
  async takeBack(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(reasonSchema) body: Reason
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.tickets.takeBack(id, user, body.reason);
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/accept')
  @HttpCode(200)
  @Roles('field_staff')
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @OccurredAt() occurredAt?: Date
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'accept', user, { occurredAt });
    return this.query.detail(id, user);
  }

  /** The staff member cannot take the job; it goes to someone else on duty, or back to the manager. */
  @Post('tickets/:id/decline')
  @HttpCode(200)
  @Roles('field_staff')
  @ApiZodBody(reasonSchema)
  async decline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(reasonSchema) body: Reason,
    @OccurredAt() occurredAt?: Date
  ): Promise<{ id: string; status: TicketStatus }> {
    // The ticket leaves the staff member's list, so there is no detail to return to them.
    return { id, status: await this.tickets.act(id, 'decline', user, { reason: body.reason, occurredAt }) };
  }

  @Post('tickets/:id/hold')
  @HttpCode(200)
  @Roles('field_staff')
  @ApiZodBody(reasonSchema)
  async hold(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(reasonSchema) body: Reason,
    @OccurredAt() occurredAt?: Date
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'hold', user, { reason: body.reason, occurredAt });
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/resume')
  @HttpCode(200)
  @Roles('field_staff')
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @OccurredAt() occurredAt?: Date
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'resume', user, { occurredAt });
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/start')
  @HttpCode(200)
  @Roles('field_staff')
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @OccurredAt() occurredAt?: Date
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'start', user, { occurredAt });
    return this.query.detail(id, user);
  }

  /** Field staff report the job done; the ticket then waits for the Call Center or NOC check. */
  @Post('tickets/:id/resolve')
  @HttpCode(200)
  @Roles('field_staff')
  @ApiZodBody(resolveTicketSchema)
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(resolveTicketSchema) body: ResolveTicket,
    @OccurredAt() occurredAt?: Date
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'resolve', user, {
      note: body.note,
      attachmentIds: body.attachmentIds,
      materials: body.materials,
      survey: body.survey,
      installation: body.installation,
      occurredAt
    });
    return this.query.detail(id, user);
  }

  /** New connections: texts the customer a code to read out to the staff member at handover. */
  @Post('tickets/:id/handover-code')
  @HttpCode(200)
  @Roles('field_staff')
  handoverCode(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser
  ): Promise<{ sentAt: string }> {
    return this.tickets.sendHandoverCode(id, user);
  }

  /**
   * NOC closes network tickets; customer tickets are closed by the Call Center system through /intake. Team and
   * technical managers close "other" tickets (checked in the service).
   */
  @Post('tickets/:id/close')
  @HttpCode(200)
  @Roles('noc', 'admin', 'team_manager', 'technical_manager')
  @ApiZodBody(noteSchema)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(noteSchema) body: z.infer<typeof noteSchema>
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'close', user, { note: body.note });
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/reopen')
  @HttpCode(200)
  @Roles('noc', 'admin', 'team_manager', 'technical_manager')
  @ApiZodBody(noteSchema)
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(noteSchema) body: z.infer<typeof noteSchema>
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'reopen', user, { note: body.note });
    return this.query.detail(id, user);
  }

  /** For duplicates, withdrawn requests or tickets created by mistake. Team managers only within their team. */
  @Post('tickets/:id/cancel')
  @HttpCode(200)
  @Roles('noc', 'admin', 'team_manager', 'technical_manager')
  @ApiZodBody(reasonSchema)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(reasonSchema) body: Reason
  ): Promise<TicketDetail> {
    await this.tickets.act(id, 'cancel', user, { reason: body.reason });
    return this.query.detail(id, user);
  }

  @Get('tickets/:id/messages')
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
  messages(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<TicketMessage[]> {
    return this.query.messages(id, user);
  }

  @Post('tickets/:id/notes')
  @HttpCode(200)
  @Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
  @ApiZodBody(ticketNoteSchema)
  async addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(ticketNoteSchema) body: TicketNote
  ): Promise<TicketDetail> {
    await this.query.detail(id, user); // 404 when the ticket is outside the caller's scope
    await this.tickets.addNote(id, user, body.text, body.notifyAssignee);
    return this.query.detail(id, user);
  }

  /** Returns a short-lived URL the app uploads the photo to directly. */
  @Post('tickets/:id/attachments')
  @Roles('field_staff')
  @ApiZodBody(attachmentUploadSchema)
  createUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(attachmentUploadSchema) body: AttachmentUpload
  ) {
    return this.tickets.createUpload(id, user, body);
  }
}
