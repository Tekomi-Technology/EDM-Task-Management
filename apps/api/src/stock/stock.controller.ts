import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  assignVehicleSchema,
  consumptionQuerySchema,
  movementQuerySchema,
  receiveStockSchema,
  reserveStockSchema,
  stockItemsSyncSchema,
  stockReceiptSyncSchema,
  transferStockSchema,
  vehicleSchema,
  type AdjustStock,
  type MovementQuery,
  type MovementView,
  type MyVan,
  type ReceiveStock,
  type StockItemView,
  type StockLine,
  type StockLocationView,
  type StockReceiptSync,
  type TicketDetail,
  type TransferStock,
  type VehicleInput,
  type VehicleView
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../common/zod';
import { eq } from 'drizzle-orm';
import { notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { tickets } from '../db/schema';
import { TicketsQuery } from '../tickets/tickets.query';
import { StockService } from './stock.service';

const OFFICE = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team'] as const;
const STOCK_MANAGERS = ['admin', 'technical_manager', 'team_manager'] as const;

@ApiTags('stock')
@ApiBearerAuth()
@Controller()
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly query: TicketsQuery,
    @Inject(DB) private readonly db: Db
  ) {}

  @Get('stock/items')
  @Roles(...OFFICE)
  items(): Promise<StockItemView[]> {
    return this.stock.items();
  }

  /** Adds or updates catalogue items by code. */
  @Put('stock/items')
  @Roles('admin', 'technical_manager')
  @ApiZodBody(stockItemsSyncSchema)
  async upsertItems(
    @ZodBody(stockItemsSyncSchema) body: z.infer<typeof stockItemsSyncSchema>
  ): Promise<{ saved: number }> {
    return { saved: await this.stock.upsertItems(body.items) };
  }

  @Get('stock/locations')
  @Roles(...OFFICE)
  locations(): Promise<StockLocationView[]> {
    return this.stock.locations();
  }

  @Get('stock/locations/:id')
  @Roles(...OFFICE)
  locationStock(@Param('id', ParseUUIDPipe) id: string): Promise<StockLine[]> {
    return this.stock.locationStock(id);
  }

  @Get('stock/movements')
  @Roles(...OFFICE)
  movements(@ZodQuery(movementQuerySchema) q: MovementQuery): Promise<MovementView[]> {
    return this.stock.movements(q);
  }

  @Post('stock/receive')
  @HttpCode(200)
  @Roles(...STOCK_MANAGERS)
  @ApiZodBody(receiveStockSchema)
  async receive(
    @ZodBody(receiveStockSchema) body: ReceiveStock,
    @CurrentUser() user: AuthUser
  ): Promise<StockLine[]> {
    await this.stock.assertCanManage(user, [body.locationId]);
    await this.stock.receive(body, user);
    return this.stock.locationStock(body.locationId);
  }

  /** "Give to a van", return to the depot, or move between depots. */
  @Post('stock/transfer')
  @HttpCode(200)
  @Roles(...STOCK_MANAGERS)
  @ApiZodBody(transferStockSchema)
  async transfer(
    @ZodBody(transferStockSchema) body: TransferStock,
    @CurrentUser() user: AuthUser
  ): Promise<StockLine[]> {
    await this.stock.assertCanManage(user, [body.fromLocationId, body.toLocationId]);
    await this.stock.transfer(body, user);
    return this.stock.locationStock(body.toLocationId);
  }

  /** After counting: record the quantity actually there. */
  @Post('stock/adjust')
  @HttpCode(200)
  @Roles(...STOCK_MANAGERS)
  @ApiZodBody(adjustStockSchema)
  async adjust(
    @ZodBody(adjustStockSchema) body: AdjustStock,
    @CurrentUser() user: AuthUser
  ): Promise<{ difference: number }> {
    await this.stock.assertCanManage(user, [body.locationId]);
    return { difference: await this.stock.adjust(body, user) };
  }

  /** Set material aside in the ticket's depot (planned work, big jobs). */
  @Post('tickets/:id/reservations')
  @HttpCode(200)
  @Roles('admin', 'technical_manager', 'team_manager', 'network_team')
  @ApiZodBody(reserveStockSchema)
  async reserve(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(reserveStockSchema) body: z.infer<typeof reserveStockSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, id));
      if (!t) throw notFound('Ticket');
      await this.stock.reserve(tx, t, body.lines);
    });
    return this.query.detail(id, user);
  }

  @Post('tickets/:id/reservations/release')
  @HttpCode(200)
  @Roles('admin', 'technical_manager', 'team_manager', 'network_team')
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser
  ): Promise<TicketDetail> {
    await this.query.detail(id, user);
    await this.db.transaction((tx) => this.stock.releaseReservations(tx, id));
    return this.query.detail(id, user);
  }

  @Get('vehicles')
  @Roles(...OFFICE)
  vehicles(@CurrentUser() user: AuthUser): Promise<VehicleView[]> {
    const managerOnly =
      user.roles.includes('team_manager') &&
      !user.roles.some((r) => r === 'admin' || r === 'technical_manager');
    return this.stock.vehicles(managerOnly ? user.teamId : undefined);
  }

  @Post('vehicles')
  @Roles('admin', 'technical_manager')
  @ApiZodBody(vehicleSchema)
  createVehicle(@ZodBody(vehicleSchema) body: VehicleInput): Promise<VehicleView> {
    return this.stock.createVehicle(body);
  }

  /** Give a van to a field staff member (or take it back with userId null). */
  @Post('vehicles/:id/assign')
  @HttpCode(200)
  @Roles(...STOCK_MANAGERS)
  @ApiZodBody(assignVehicleSchema)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(assignVehicleSchema) body: z.infer<typeof assignVehicleSchema>,
    @CurrentUser() user: AuthUser
  ): Promise<VehicleView[]> {
    await this.stock.assignVehicle(id, body.userId, user);
    return this.vehicles(user);
  }

  /** The field staff member's van and what is in it, for recording materials in the app. */
  @Get('me/van')
  @Roles('field_staff')
  myVan(@CurrentUser() user: AuthUser): Promise<MyVan> {
    return this.stock.myVan(user.userId!);
  }
}

/** API for EDM's stock management system. Authenticate with the `stock-system` client. */
@ApiTags('intake: stock system')
@ApiBearerAuth()
@Controller('intake/stock')
@Roles('integration_stock')
export class StockIntakeController {
  constructor(private readonly stock: StockService) {}

  @Post('receipts')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Goods received at a depot',
    description: 'Sending the same externalRef again does nothing.'
  })
  @ApiZodBody(stockReceiptSyncSchema)
  receipt(@ZodBody(stockReceiptSyncSchema) body: StockReceiptSync, @CurrentUser() user: AuthUser) {
    return this.stock.syncReceipt(body, user);
  }

  @Put('items')
  @ApiOperation({ summary: 'Add or update catalogue items by code' })
  @ApiZodBody(stockItemsSyncSchema)
  async items(
    @ZodBody(stockItemsSyncSchema) body: z.infer<typeof stockItemsSyncSchema>
  ): Promise<{ saved: number }> {
    return { saved: await this.stock.upsertItems(body.items) };
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Materials used on jobs since a time (oldest first), to deduct on your side' })
  @ApiZodQuery(consumptionQuerySchema)
  consumption(@ZodQuery(consumptionQuerySchema) q: z.infer<typeof consumptionQuerySchema>) {
    return this.stock.consumption(q.since, q.limit);
  }
}
