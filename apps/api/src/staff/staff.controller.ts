import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  areaFilterSchema,
  type AreaFilter,
  fieldStaffQuerySchema,
  locationBatchSchema,
  type FieldStaffQuery,
  type LiveMap,
  type LocationBatch,
  type StaffPerformance,
  type StaffSuggestion
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { TicketsQuery } from '../tickets/tickets.query';
import { UsersService } from '../users/users.service';
import { LocationService } from '../location/location.service';
import { StaffService } from './staff.service';

const suggestionQuerySchema = z.object({ ticketId: z.string().uuid().optional() });

const OFFICE = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team'] as const;

@ApiTags('field staff')
@ApiBearerAuth()
@Controller()
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly locationService: LocationService,
    private readonly users: UsersService,
    private readonly query: TicketsQuery
  ) {}

  /**
   * Field staff who can take tickets of this team, best choice first (the Assign screen): on duty, fewest
   * unfinished jobs, nearest to the ticket when one is given, then whoever waited longest.
   */
  @Get('teams/:teamId/suggestions')
  @Roles('team_manager', 'technical_manager', 'admin')
  async suggestions(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser() user: AuthUser,
    @ZodQuery(suggestionQuerySchema) q: z.infer<typeof suggestionQuerySchema>
  ): Promise<StaffSuggestion[]> {
    if (!user.roles.some((r) => r === 'admin' || r === 'technical_manager') && user.teamId !== teamId) {
      throw new AppError(HttpStatus.FORBIDDEN, 'NOT_IN_TEAM', 'You can only see staff of your own team');
    }
    const near = q.ticketId ? (await this.query.detail(q.ticketId, user)).location : null;
    return this.users.suggestions(teamId, near);
  }

  /** The app sends positions while the person is on duty, in batches (also ones kept while offline). */
  @Post('me/locations')
  @HttpCode(200)
  @Roles('field_staff')
  @ApiZodBody(locationBatchSchema)
  async locations(
    @CurrentUser() user: AuthUser,
    @ZodBody(locationBatchSchema) body: LocationBatch
  ): Promise<{ accepted: number }> {
    // Positions are only kept while on duty: off duty is private time.
    if (!user.onDuty) return { accepted: 0 };
    return { accepted: await this.locationService.record(user.userId!, body.points) };
  }

  @Get('live')
  @Roles(...OFFICE)
  live(@CurrentUser() user: AuthUser, @ZodQuery(areaFilterSchema) q: AreaFilter): Promise<LiveMap> {
    return this.staff.liveMap(user, q.areaId);
  }

  @Get('field-staff')
  @Roles(...OFFICE)
  fieldStaff(
    @CurrentUser() user: AuthUser,
    @ZodQuery(fieldStaffQuerySchema) q: FieldStaffQuery
  ): Promise<StaffPerformance[]> {
    return this.staff.performance(user, q.days, q.teamId, q.areaId);
  }
}
