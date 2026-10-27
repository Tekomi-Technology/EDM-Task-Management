import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { reportQuerySchema, type Report, type ReportQuery } from '../contract';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodQuery } from '../common/zod';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@Roles('admin', 'technical_manager', 'team_manager', 'noc')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** KPIs for the Reports screen. Team managers see their own team. */
  @Get()
  report(@CurrentUser() user: AuthUser, @ZodQuery(reportQuerySchema) q: ReportQuery): Promise<Report> {
    return this.reports.report(user, q);
  }

  /** "Download report": every ticket received, fixed or closed in the period, as a CSV file for Excel. */
  @Get('tickets.csv')
  async ticketsCsv(
    @CurrentUser() user: AuthUser,
    @ZodQuery(reportQuerySchema) q: ReportQuery,
    @Res({ passthrough: true }) res: Response
  ): Promise<string> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="edm-tickets-${q.from}-to-${q.to}.csv"`);
    return this.reports.ticketsCsv(user, q);
  }
}
