import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  customerLookupSchema,
  officeTicketSchema,
  reverseGeocodeSchema,
  ticketPreviewSchema,
  type CreatedTicketView,
  type CustomerMatch,
  type OfficeTicket,
  type PlaceTeam,
  type TicketPreview,
  type TicketPreviewInput
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { OfficeTicketsService } from './office-tickets.service';

/** EDM staff who answer the phone themselves (the Call Center normally sends tickets through /intake). */
const TAKES_CALLS = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support'] as const;

@ApiTags('tickets')
@ApiBearerAuth()
@Controller()
@Roles(...TAKES_CALLS)
export class OfficeTicketsController {
  constructor(private readonly office: OfficeTicketsService) {}

  /** Finds the caller by phone, contract or meter number (or name). */
  @Get('customers/lookup')
  lookup(@ZodQuery(customerLookupSchema) q: z.infer<typeof customerLookupSchema>): Promise<CustomerMatch[]> {
    return this.office.lookup(q.q);
  }

  /** What would happen if the ticket were created now; creates nothing. */
  @Post('tickets/preview')
  @HttpCode(200)
  @ApiZodBody(ticketPreviewSchema)
  preview(@ZodBody(ticketPreviewSchema) body: TicketPreviewInput): Promise<TicketPreview> {
    return this.office.preview(body);
  }

  /** Which area and team a point on the map falls in (forms that only have a place, like surveys). */
  @Get('places/team')
  placeTeam(@ZodQuery(reverseGeocodeSchema) q: z.infer<typeof reverseGeocodeSchema>): Promise<PlaceTeam> {
    return this.office.placeTeam(q);
  }

  @Post('tickets')
  @ApiZodBody(officeTicketSchema)
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(officeTicketSchema) body: OfficeTicket
  ): Promise<CreatedTicketView> {
    return this.office.create(body, user);
  }
}
