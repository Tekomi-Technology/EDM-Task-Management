import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { inboxReadSchema, type Inbox, type InboxRead } from '@edm/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { ApiZodBody, ZodBody } from '../common/zod';
import { DB, type Db } from '../db/db.module';
import { userNotifications } from '../db/schema';

/** The bell in the web app: office alerts for the signed-in person, newest first. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class InboxController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<Inbox> {
    if (!user.userId) return { unread: 0, items: [] };
    const mine = eq(userNotifications.userId, user.userId);
    const [rows, [unread]] = await Promise.all([
      this.db
        .select()
        .from(userNotifications)
        .where(mine)
        .orderBy(desc(userNotifications.createdAt))
        .limit(30),
      this.db
        .select({ n: count() })
        .from(userNotifications)
        .where(and(mine, isNull(userNotifications.readAt)))
    ]);
    return {
      unread: unread?.n ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        link: r.link,
        createdAt: r.createdAt.toISOString(),
        read: r.readAt !== null
      }))
    };
  }

  @Post('read')
  @HttpCode(204)
  @ApiZodBody(inboxReadSchema)
  async read(@CurrentUser() user: AuthUser, @ZodBody(inboxReadSchema) body: InboxRead): Promise<void> {
    if (!user.userId) return;
    await this.db
      .update(userNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(userNotifications.userId, user.userId),
          isNull(userNotifications.readAt),
          body.ids ? inArray(userNotifications.id, body.ids) : undefined
        )
      );
  }
}
