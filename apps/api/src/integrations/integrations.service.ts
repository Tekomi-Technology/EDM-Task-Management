import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INTEGRATION_SYSTEMS,
  type IntegrationCallView,
  type IntegrationProblem,
  type IntegrationStatus,
  type IntegrationSystem,
  type IntegrationsOverview,
  type IntegrationTestResult,
  type IntegrationView
} from '../contract';
import { desc, eq, sql } from 'drizzle-orm';
import { IdentityAdmin } from '../admin/identity-admin';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from '../db/db.module';
import { integrationCalls } from '../db/schema';
import { sendWebhook } from '../notifications/webhook-sender';

/** Answers slower than this on average over the last hour make a system "slow". */
const SLOW_MS = 5_000;
const TODAY = sql.raw(`(date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo')`);

/** The sign-in client each system uses to call /intake. */
const CLIENT_ID: Partial<Record<IntegrationSystem, string>> = {
  call_center: 'call-center-system',
  sales: 'sales-system',
  nms: 'nms-system',
  stock: 'stock-system'
};
const NAME: Record<IntegrationSystem, string> = {
  call_center: 'The Call Center',
  sales: 'The Sales system',
  nms: 'The NMS',
  stock: 'The stock system',
  sms: 'The SMS gateway',
  push: 'The push service'
};

export interface CallRecord {
  system: IntegrationSystem;
  direction: 'in' | 'out';
  operation: string;
  statusCode?: number | null;
  ok: boolean;
  durationMs: number;
  error?: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** What the other systems sent us and what we sent them: the Connected systems screen (W17). */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly identity: IdentityAdmin
  ) {}

  /** Never fails the request or delivery it describes. */
  async record(call: CallRecord): Promise<void> {
    try {
      await this.db.insert(integrationCalls).values({
        ...call,
        error: call.error?.slice(0, 500) ?? null,
        durationMs: Math.round(call.durationMs)
      });
    } catch (err) {
      this.logger.warn(`Could not log the ${call.system} call: ${(err as Error).message}`);
    }
  }

  async overview(): Promise<IntegrationsOverview> {
    const [latest, calls, today, problems] = await Promise.all([
      // The last call and the last good call of each system (index on system, created_at).
      this.db.execute<{
        system: IntegrationSystem;
        ok: boolean | null;
        status_code: number | null;
        error: string | null;
        last_at: string | null;
        last_ok_at: string | null;
      }>(sql`
        select s.system, l.ok, l.status_code, l.error, l.created_at as last_at, g.created_at as last_ok_at
        from unnest(enum_range(null::integration_system)) as s(system)
        left join lateral (
          select ok, status_code, error, created_at from integration_calls c
          where c.system = s.system order by created_at desc limit 1
        ) l on true
        left join lateral (
          select created_at from integration_calls c
          where c.system = s.system and c.ok order by created_at desc limit 1
        ) g on true`),
      this.db.execute<{ system: IntegrationSystem; calls: number; avg_ms: number | null }>(sql`
        select system, count(*) filter (where created_at >= ${TODAY})::int as calls,
               avg(duration_ms) filter (where created_at >= now() - interval '1 hour') as avg_ms
        from integration_calls where created_at >= least(${TODAY}, now() - interval '1 hour')
        group by system`),
      this.db.execute<Record<string, number>>(sql`
        select
          (select count(*) from tickets where source = 'call_center' and created_at >= ${TODAY})::int as cc_tickets,
          (select count(*) from tickets where source = 'sales' and created_at >= ${TODAY})::int as sales_requests,
          (select count(*) from notification_outbox where channel = 'webhook' and status = 'sent'
             and sent_at >= ${TODAY})::int as webhooks_sent,
          (select count(*) from alarms where raised_at >= ${TODAY})::int as alarms,
          (select count(*) from tickets where type = 'network_incident' and source = 'nms'
             and created_at >= ${TODAY})::int as incidents,
          (select count(*) from stock_movements where kind = 'receive' and actor_label = 'EDM stock system'
             and created_at >= ${TODAY})::int as receipts,
          (select count(*) from notification_outbox where channel = 'sms' and status = 'sent'
             and sent_at >= ${TODAY})::int as sms_sent,
          (select count(*) from notification_outbox where channel = 'sms' and status = 'failed'
             and created_at >= ${TODAY})::int as sms_failed,
          (select count(*) from notification_outbox where channel = 'push' and status = 'sent'
             and sent_at >= ${TODAY})::int as push_sent,
          (select count(*) from notification_outbox where channel = 'push' and status = 'failed'
             and created_at >= ${TODAY})::int as push_failed`),
      this.problems()
    ]);

    const t = today.rows[0]!;
    const byCalls = new Map(calls.rows.map((r) => [r.system, r]));
    const delivered = (sent: number, failed: number) =>
      sent + failed === 0 ? '' : ` · ${Math.round((sent / (sent + failed)) * 1000) / 10}% delivered`;
    const todayText: Record<IntegrationSystem, string> = {
      call_center: `${plural(t.cc_tickets!, 'ticket')} received`,
      sales: `${plural(t.sales_requests!, 'request')} received · ${plural(t.webhooks_sent!, 'result')} sent back`,
      nms: `${plural(t.alarms!, 'alarm')} → ${plural(t.incidents!, 'incident')}`,
      stock: `${plural(t.receipts!, 'delivery', 'deliveries')} booked · ${plural(byCalls.get('stock')?.calls ?? 0, 'request')}`,
      sms: `${plural(t.sms_sent!, 'SMS', 'SMS')} sent${delivered(t.sms_sent!, t.sms_failed!)}`,
      push: `${plural(t.push_sent!, 'notification')} sent${delivered(t.push_sent!, t.push_failed!)}`
    };

    const systems = latest.rows.map((r): IntegrationView => {
      const avgMs = byCalls.get(r.system)?.avg_ms;
      const status = this.status(r, avgMs === null || avgMs === undefined ? null : Number(avgMs));
      return {
        system: r.system,
        status: status.status,
        lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
        lastOkAt: r.last_ok_at ? new Date(r.last_ok_at).toISOString() : null,
        today: todayText[r.system],
        note: status.note
      };
    });
    systems.sort((a, b) => INTEGRATION_SYSTEMS.indexOf(a.system) - INTEGRATION_SYSTEMS.indexOf(b.system));
    return { systems, problems };
  }

  private status(
    r: { system: IntegrationSystem; ok: boolean | null; status_code: number | null; error: string | null },
    avgMs: number | null
  ): { status: IntegrationStatus; note: string | null } {
    if (r.system === 'sms' && this.env.SMS_PROVIDER === 'log') {
      return { status: 'not_set', note: 'Test mode: SMS are written to the server log, not sent' };
    }
    const webhookNote =
      r.system === 'sales' && !this.env.SALES_WEBHOOK_URL
        ? 'Results are not sent back: SALES_WEBHOOK_URL is not set'
        : null;
    if (r.ok === null) return { status: 'quiet', note: webhookNote ?? 'No contact yet' };
    const serious =
      r.status_code === null || r.status_code >= 500 || r.status_code === 401 || r.status_code === 403;
    if (!r.ok && serious) return { status: 'problem', note: r.error ?? `Answer ${r.status_code}` };
    if (avgMs !== null && avgMs > SLOW_MS) {
      return { status: 'slow', note: `Answers take ${Math.round(avgMs / 100) / 10} s on average` };
    }
    return { status: 'connected', note: webhookNote };
  }

  /**
   * Failures of the last 7 days, grouped by system, error and hour. Answers that are part of normal work
   * (a ticket not found, a change not allowed now) are left out; a refused sign-in, unreadable data, our
   * own errors and failed deliveries are kept. Solved once a later call of that system went through.
   */
  private async problems(): Promise<IntegrationProblem[]> {
    const rows = await this.db.execute<{
      system: IntegrationSystem;
      direction: 'in' | 'out';
      error: string;
      first_at: string;
      last_at: string;
      count: number;
      solved: boolean;
    }>(sql`
      select p.*, exists (
        select 1 from integration_calls g where g.system = p.system and g.ok and g.created_at > p.last_at
      ) as solved
      from (
        select system, direction, coalesce(error, 'Answer ' || status_code) as error,
               min(created_at) as first_at, max(created_at) as last_at, count(*)::int as count
        from integration_calls
        where not ok and created_at >= now() - interval '7 days'
          and (direction = 'out' or status_code is null or status_code >= 500 or status_code in (400, 401, 403, 422))
        group by system, direction, coalesce(error, 'Answer ' || status_code), date_trunc('hour', created_at)
      ) p
      order by p.last_at desc
      limit 20`);
    return rows.rows.map((r) => ({
      system: r.system,
      firstAt: new Date(r.first_at).toISOString(),
      lastAt: new Date(r.last_at).toISOString(),
      count: Number(r.count),
      message:
        (r.direction === 'in'
          ? `${plural(Number(r.count), 'request')} refused: `
          : `${plural(Number(r.count), 'delivery', 'deliveries')} failed: `) + r.error,
      solved: r.solved
    }));
  }

  async calls(system: IntegrationSystem): Promise<IntegrationCallView[]> {
    const rows = await this.db
      .select()
      .from(integrationCalls)
      .where(eq(integrationCalls.system, system))
      .orderBy(desc(integrationCalls.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      operation: r.operation,
      statusCode: r.statusCode,
      ok: r.ok,
      durationMs: r.durationMs,
      error: r.error,
      createdAt: r.createdAt.toISOString()
    }));
  }

  /**
   * "Test connection". For systems that call us: is their sign-in account enabled. For the ones we call: do they
   * answer (no SMS or push is sent; the Sales system gets a signed "ping" event).
   */
  async test(system: IntegrationSystem): Promise<IntegrationTestResult> {
    const results: IntegrationTestResult[] = [];
    const clientId = CLIENT_ID[system];
    if (clientId) results.push(await this.testClient(system, clientId));
    if (system === 'sales') results.push(await this.testWebhook());
    if (system === 'sms') results.push(await this.testSms());
    if (system === 'push') results.push(await this.reach(this.env.EXPO_PUSH_URL, NAME.push));
    return {
      ok: results.every((r) => r.ok),
      message: results.map((r) => r.message).join(' '),
      durationMs: results.reduce<number | null>((max, r) => Math.max(max ?? 0, r.durationMs ?? 0), null)
    };
  }

  private async testClient(system: IntegrationSystem, clientId: string): Promise<IntegrationTestResult> {
    try {
      const enabled = await this.identity.clientEnabled(clientId);
      if (enabled === null)
        return { ok: false, message: `No sign-in account ${clientId} in Keycloak.`, durationMs: null };
      return enabled
        ? { ok: true, message: `${NAME[system]}'s sign-in account is enabled.`, durationMs: null }
        : {
            ok: false,
            message: `${NAME[system]}'s sign-in account ${clientId} is disabled.`,
            durationMs: null
          };
    } catch (err) {
      return {
        ok: false,
        message: `Could not check the sign-in account: ${(err as Error).message}`,
        durationMs: null
      };
    }
  }

  private async testWebhook(): Promise<IntegrationTestResult> {
    const url = this.env.SALES_WEBHOOK_URL;
    if (!url)
      return {
        ok: false,
        message: 'SALES_WEBHOOK_URL is not set, so results are not sent back.',
        durationMs: null
      };
    const started = performance.now();
    try {
      await sendWebhook(
        url,
        JSON.stringify({ event: 'ping', sentAt: new Date().toISOString() }),
        this.env.SALES_WEBHOOK_SECRET
      );
      return {
        ok: true,
        message: 'The Sales system accepted a test event.',
        durationMs: Math.round(performance.now() - started)
      };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        durationMs: Math.round(performance.now() - started)
      };
    }
  }

  private async testSms(): Promise<IntegrationTestResult> {
    if (this.env.SMS_PROVIDER === 'log' || !this.env.SMS_HTTP_URL) {
      return {
        ok: true,
        message: 'Test mode: SMS are written to the server log, nothing is sent.',
        durationMs: null
      };
    }
    return this.reach(this.env.SMS_HTTP_URL, NAME.sms);
  }

  /** Any HTTP answer means the service is reachable; nothing is sent. */
  private async reach(url: string, name: string): Promise<IntegrationTestResult> {
    const started = performance.now();
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
      const ms = Math.round(performance.now() - started);
      return { ok: true, message: `${name} answered in ${ms} ms.`, durationMs: ms };
    } catch (err) {
      return {
        ok: false,
        message: `${name} did not answer: ${(err as Error).message}`,
        durationMs: Math.round(performance.now() - started)
      };
    }
  }
}
