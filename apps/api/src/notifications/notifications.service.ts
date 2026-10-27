import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DB, type Db, type Tx } from '../db/db.module';
import { notificationOutbox, pushDevices, userNotifications, type PushPayload } from '../db/schema';
import { IntegrationsService } from '../integrations/integrations.service';
import { PermanentDeliveryError } from './delivery-error';
import { sendWebhook } from './webhook-sender';
import { PUSH_SENDER, type PushSender } from './push-sender';
import { SMS_SENDER, type SmsSender } from './sms-sender';

export interface OutgoingSms {
  /** Phone number; messages without one are skipped. */
  recipient: string | null | undefined;
  body: string;
  /** The ticket it is about, if any (help requests may not be about one). */
  ticketId?: string | null;
  /**
   * Set for messages to field staff: they are told through the app by push notification when they have it,
   * following STAFF_ALERTS, with SMS as the fallback.
   */
  staff?: { userId: string; title: string };
  /**
   * Set for messages to office staff: the alert also appears under the bell in the web app (in English, with a
   * link), even when the person has no phone number for the SMS.
   */
  office?: { userId: string; title: string; link?: string };
}

type OutboxInsert = typeof notificationOutbox.$inferInsert;

const QUEUE = 'notifications';
const MAX_ATTEMPTS = 5;
const SWEEP_MS = 60_000;

/**
 * Outbox pattern: messages are written in the same transaction as the ticket change, then handed to BullMQ
 * after commit. A sweeper re-queues anything still pending, so a crash between commit and enqueue loses nothing.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly connection: IORedis;
  private readonly queue: Queue;
  private worker?: Worker;
  private sweeper?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    private readonly integrations: IntegrationsService
  ) {
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
  }

  onModuleInit(): void {
    if (!this.env.RUN_WORKERS) return;
    this.worker = new Worker(QUEUE, (job) => this.deliver(job.data.outboxId as string), {
      connection: this.connection.duplicate(),
      concurrency: 5
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Notification ${job?.data.outboxId} failed: ${err.message}`)
    );
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }

  /** Records messages inside the caller's transaction. Returns the outbox ids to pass to dispatch(). */
  async record(tx: Tx, messages: OutgoingSms[]): Promise<string[]> {
    const rows: OutboxInsert[] = [];
    for (const m of messages) {
      const devices =
        m.staff && this.env.STAFF_ALERTS !== 'sms_only'
          ? await tx
              .select({ token: pushDevices.token })
              .from(pushDevices)
              .where(eq(pushDevices.userId, m.staff.userId))
          : [];
      for (const d of devices) {
        rows.push({
          channel: 'push',
          recipient: d.token,
          body: m.body,
          ticketId: m.ticketId ?? null,
          payload: {
            title: m.staff!.title,
            data: m.ticketId ? { ticketId: m.ticketId } : {},
            fallbackPhone: this.env.STAFF_ALERTS === 'push_or_sms' ? (m.recipient ?? null) : null
          }
        });
      }
      const smsToo = devices.length === 0 || this.env.STAFF_ALERTS === 'push_and_sms';
      if (smsToo && m.recipient) {
        rows.push({ channel: 'sms', recipient: m.recipient, body: m.body, ticketId: m.ticketId ?? null });
      }
    }
    const inbox = messages
      .filter((m) => m.office)
      .map((m) => ({
        userId: m.office!.userId,
        title: m.office!.title,
        link: m.office!.link ?? (m.ticketId ? `/tickets/${m.ticketId}` : null),
        ticketId: m.ticketId ?? null
      }));
    if (inbox.length > 0) await tx.insert(userNotifications).values(inbox);
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(notificationOutbox)
      .values(rows)
      .returning({ id: notificationOutbox.id });
    return inserted.map((r) => r.id);
  }

  /**
   * Queues an event for the Sales system's webhook (survey done, connection installed…), in the caller's
   * transaction, for tickets Sales asked for. Delivered with retries like SMS. Nothing happens without a URL.
   * Returns the outbox ids to pass to dispatch() after commit.
   */
  async recordWebhook(
    tx: Tx,
    event: string,
    ticket: { id: string; code: string; source: string; externalRef: string | null },
    data: Record<string, unknown>
  ): Promise<string[]> {
    if (ticket.source !== 'sales' || !this.env.SALES_WEBHOOK_URL) return [];
    const body = JSON.stringify({
      event,
      externalRef: ticket.externalRef,
      code: ticket.code,
      sentAt: new Date().toISOString(),
      data
    });
    const [row] = await tx
      .insert(notificationOutbox)
      .values({ channel: 'webhook', recipient: this.env.SALES_WEBHOOK_URL, body, ticketId: ticket.id })
      .returning({ id: notificationOutbox.id });
    return [row!.id];
  }

  /** Remembers the phone a person signed in on, so jobs reach them by push. A phone belongs to its last user. */
  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    await this.db
      .insert(pushDevices)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: pushDevices.token, set: { userId, platform, lastSeenAt: new Date() } });
  }

  /** Called when someone signs out of the app, so the next person on that phone does not get their jobs. */
  async removeDevice(userId: string, token: string): Promise<void> {
    await this.db
      .delete(pushDevices)
      .where(and(eq(pushDevices.token, token), eq(pushDevices.userId, userId)));
  }

  /** Hands recorded messages to the queue; call after the transaction has committed. */
  async dispatch(outboxIds: string[]): Promise<void> {
    if (outboxIds.length === 0) return;
    try {
      await this.queue.addBulk(
        outboxIds.map((id) => ({
          name: 'send',
          data: { outboxId: id },
          opts: {
            jobId: id,
            attempts: MAX_ATTEMPTS,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true
          }
        }))
      );
    } catch (err) {
      // The sweeper will pick these up; the ticket change itself has already been saved.
      this.logger.warn(`Could not queue notifications: ${(err as Error).message}`);
    }
  }

  private async deliver(outboxId: string): Promise<void> {
    const [row] = await this.db.select().from(notificationOutbox).where(eq(notificationOutbox.id, outboxId));
    if (!row || row.status !== 'pending') return;
    const started = performance.now();
    const log = (ok: boolean, error?: string) =>
      this.integrations.record({
        system: row.channel === 'webhook' ? 'sales' : row.channel,
        direction: 'out',
        operation:
          row.channel === 'webhook'
            ? `Webhook ${(JSON.parse(row.body) as { event?: string }).event ?? ''}`.trim()
            : row.channel === 'sms'
              ? 'SMS'
              : 'Push',
        ok,
        durationMs: performance.now() - started,
        error
      });
    try {
      if (row.channel === 'push') {
        const payload = row.payload!;
        await this.push.send({ to: row.recipient, title: payload.title, body: row.body, data: payload.data });
      } else if (row.channel === 'webhook') {
        await sendWebhook(row.recipient, row.body, this.env.SALES_WEBHOOK_SECRET);
      } else {
        await this.sms.send(row.recipient, row.body);
      }
      await this.db
        .update(notificationOutbox)
        .set({
          status: 'sent',
          sentAt: new Date(),
          attempts: sql`${notificationOutbox.attempts} + 1`,
          lastError: null
        })
        .where(eq(notificationOutbox.id, outboxId));
      await log(true);
    } catch (err) {
      // A phone that uninstalled the app is the person's business, not a broken link to the push service.
      const serviceAnswered = err instanceof PermanentDeliveryError && err.code === 'DeviceNotRegistered';
      await log(serviceAnswered, (err as Error).message);
      const attempts = row.attempts + 1;
      const permanent = err instanceof PermanentDeliveryError;
      const final = permanent || attempts >= MAX_ATTEMPTS;
      await this.db
        .update(notificationOutbox)
        .set({ attempts, lastError: (err as Error).message, status: final ? 'failed' : 'pending' })
        .where(eq(notificationOutbox.id, outboxId));
      if (final && row.channel === 'push')
        await this.pushFailed(row.recipient, row.body, row.ticketId, row.payload, err);
      if (permanent) throw new UnrecoverableError((err as Error).message);
      throw err;
    }
  }

  /** Forgets phones that uninstalled the app, and texts the person instead when the push could not be delivered. */
  private async pushFailed(
    token: string,
    body: string,
    ticketId: string | null,
    payload: PushPayload | null,
    err: unknown
  ): Promise<void> {
    if (err instanceof PermanentDeliveryError && err.code === 'DeviceNotRegistered') {
      await this.db.delete(pushDevices).where(eq(pushDevices.token, token));
    }
    if (!payload?.fallbackPhone) return;
    const [sms] = await this.db
      .insert(notificationOutbox)
      .values({ channel: 'sms', recipient: payload.fallbackPhone, body, ticketId })
      .returning({ id: notificationOutbox.id });
    await this.dispatch([sms.id]);
  }

  private async sweep(): Promise<void> {
    try {
      const stale = await this.db
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.status, 'pending'),
            lt(notificationOutbox.createdAt, new Date(Date.now() - SWEEP_MS))
          )
        )
        .limit(500);
      await this.dispatch(stale.map((r) => r.id));
    } catch (err) {
      this.logger.warn(`Notification sweep failed: ${(err as Error).message}`);
    }
  }

  /** Used by the health check. */
  async ping(): Promise<void> {
    await this.connection.ping();
  }

  /** Test helper: statuses of a set of outbox rows. */
  async statuses(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ status: notificationOutbox.status })
      .from(notificationOutbox)
      .where(inArray(notificationOutbox.id, ids));
    return rows.map((r) => r.status);
  }
}
