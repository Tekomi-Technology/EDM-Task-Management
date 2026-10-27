import { Inject, Injectable } from '@nestjs/common';
import { SEVERITY_RULES, type AlarmSeverity, type NmsAlarmEvent } from '../contract';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { DB, type Db, type Tx } from '../db/db.module';
import { alarms, tickets } from '../db/schema';
import { inbox, push, sms, toOffice } from '../notifications/messages';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';

export type AlarmOutcome = 'created' | 'grouped' | 'updated' | 'cleared' | 'recorded' | 'ignored';

export interface AlarmResult {
  alarmId: string;
  result: AlarmOutcome;
  ticketId: string | null;
  code: string | null;
}

const RANK: Record<AlarmSeverity, number> = { critical: 3, major: 2, minor: 1, warning: 0 };
/** Incidents still being worked on, which new alarms with the same cause join. */
const OPEN = ['new', 'assigned', 'accepted', 'in_progress', 'on_hold', 'reopened', 'resolved'] as const;

/**
 * Turns NMS alarms into network incident tickets. Alarms with the same cause are grouped into one incident:
 * first by the NMS's correlation id, then by network element, then by the element feeding it (or fed by it).
 * Warnings are recorded but do not open an incident.
 */
@Injectable()
export class NmsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tickets: TicketsService,
    private readonly users: UsersService
  ) {}

  async receive(events: NmsAlarmEvent[], actor: AuthUser): Promise<AlarmResult[]> {
    const results: AlarmResult[] = [];
    // One at a time, in the order sent: a clear may follow its raise in the same batch.
    for (const e of events) {
      const outboxIds: string[] = [];
      const result = await this.db.transaction(async (tx) => {
        // Serialise grouping, so two alarms of the same fault arriving together still make one incident.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nms-alarm-grouping'))`);
        return e.event === 'raise'
          ? this.raise(tx, e, actor, outboxIds)
          : this.clear(tx, e, actor, outboxIds);
      });
      await this.tickets.dispatch(outboxIds);
      results.push(result);
    }
    return results;
  }

  private async raise(tx: Tx, e: NmsAlarmEvent, actor: AuthUser, outboxIds: string[]): Promise<AlarmResult> {
    const [existing] = await tx.select().from(alarms).where(eq(alarms.alarmId, e.alarmId));
    const values = {
      elementCode: e.elementCode,
      elementName: e.elementName ?? null,
      elementType: e.elementType ?? null,
      parentElementCode: e.parentElementCode ?? null,
      correlationId: e.correlationId ?? null,
      alarmType: e.alarmType,
      severity: e.severity,
      location: e.location ?? null,
      customersAffected: e.customersAffected ?? null,
      details: e.details ?? null,
      updatedAt: new Date()
    };

    // The same alarm sent again while active: refresh it, nothing new happens.
    if (existing && !existing.clearedAt) {
      await tx.update(alarms).set(values).where(eq(alarms.id, existing.id));
      if (existing.ticketId) await this.updateIncident(tx, existing.ticketId, e);
      return {
        alarmId: e.alarmId,
        result: 'updated',
        ticketId: existing.ticketId,
        code: await this.codeOf(tx, existing.ticketId)
      };
    }

    const [alarm] = existing
      ? await tx
          .update(alarms)
          .set({ ...values, raisedAt: new Date(e.occurredAt), clearedAt: null, ticketId: null })
          .where(eq(alarms.id, existing.id))
          .returning()
      : await tx
          .insert(alarms)
          .values({ ...values, alarmId: e.alarmId, raisedAt: new Date(e.occurredAt) })
          .returning();

    if (e.severity === 'warning')
      return { alarmId: e.alarmId, result: 'recorded', ticketId: null, code: null };

    const incident = await this.findIncident(tx, e);
    if (incident) {
      await tx.update(alarms).set({ ticketId: incident.id }).where(eq(alarms.id, alarm!.id));
      await this.updateIncident(tx, incident.id, e);
      await this.tickets.event(tx, incident.id, 'alarm_raised', actor, {
        alarmId: e.alarmId,
        alarmType: e.alarmType,
        elementCode: e.elementCode,
        severity: e.severity
      });
      // A new alarm on an incident the crew says is fixed: NOC should look before closing.
      if (incident.status === 'resolved') {
        const messages = toOffice(
          await this.users.withRole('noc', tx),
          sms.nocNewIncident(incident.code, `novo alarme: ${e.alarmType}`),
          inbox.alarmOnFixed(incident.code, e.alarmType),
          incident.id
        );
        outboxIds.push(...(await this.tickets.recordMessages(tx, messages)));
      }
      return { alarmId: e.alarmId, result: 'grouped', ticketId: incident.id, code: incident.code };
    }

    const rule = SEVERITY_RULES[e.severity];
    const created = await this.tickets.createInTx(
      tx,
      {
        type: 'network_incident',
        source: 'nms',
        // Alarm ids are kept on the alarms; an incident may be opened again later for the same correlation id.
        externalRef: null,
        problemType: null,
        priority: rule.priority,
        slaMinutes: rule.slaMinutes,
        title: `${e.alarmType} · ${e.elementName ?? e.elementCode}`,
        description:
          e.details ?? `${e.alarmType} on ${e.elementName ?? e.elementCode} (NMS alarm ${e.alarmId}).`,
        customerId: null,
        customerPhone: null,
        location: e.location ?? null,
        elementCode: e.elementCode,
        elementName: e.elementName ?? null,
        severity: e.severity,
        customersAffected: e.customersAffected ?? null
      },
      actor
    );
    outboxIds.push(...created.outboxIds);
    await tx.update(alarms).set({ ticketId: created.ticket.id }).where(eq(alarms.id, alarm!.id));
    return { alarmId: e.alarmId, result: 'created', ticketId: created.ticket.id, code: created.ticket.code };
  }

  private async clear(tx: Tx, e: NmsAlarmEvent, actor: AuthUser, outboxIds: string[]): Promise<AlarmResult> {
    const [alarm] = await tx.select().from(alarms).where(eq(alarms.alarmId, e.alarmId));
    if (!alarm || alarm.clearedAt) {
      return { alarmId: e.alarmId, result: 'ignored', ticketId: alarm?.ticketId ?? null, code: null };
    }
    await tx
      .update(alarms)
      .set({ clearedAt: new Date(e.occurredAt), updatedAt: new Date() })
      .where(eq(alarms.id, alarm.id));
    if (!alarm.ticketId) return { alarmId: e.alarmId, result: 'cleared', ticketId: null, code: null };

    await this.tickets.event(tx, alarm.ticketId, 'alarm_cleared', actor, {
      alarmId: e.alarmId,
      alarmType: alarm.alarmType,
      elementCode: alarm.elementCode
    });
    const [{ active }] = (
      await tx.execute<{ active: number }>(
        sql`select count(*)::int as active from alarms where ticket_id = ${alarm.ticketId} and cleared_at is null`
      )
    ).rows;
    if (active === 0) {
      // Everything is back according to the NMS: tell whoever holds the job; NOC still confirms and closes.
      await this.tickets.event(tx, alarm.ticketId, 'all_alarms_cleared', actor, {});
      const [t] = await tx
        .select({ code: tickets.code, assigneeId: tickets.assigneeId, status: tickets.status })
        .from(tickets)
        .where(eq(tickets.id, alarm.ticketId));
      if (t?.assigneeId && ['assigned', 'accepted', 'in_progress', 'on_hold'].includes(t.status)) {
        const staff = await this.users.findById(t.assigneeId, tx);
        outboxIds.push(
          ...(await this.tickets.recordMessages(tx, [
            {
              recipient: staff?.phone ?? null,
              body: sms.staffAlarmsCleared(t.code),
              ticketId: alarm.ticketId,
              staff: { userId: t.assigneeId, title: push.alarmsCleared }
            }
          ]))
        );
      }
    }
    return {
      alarmId: e.alarmId,
      result: 'cleared',
      ticketId: alarm.ticketId,
      code: await this.codeOf(tx, alarm.ticketId)
    };
  }

  /** The open incident this alarm belongs to, if any (same cause). */
  private async findIncident(
    tx: Tx,
    e: NmsAlarmEvent
  ): Promise<{ id: string; code: string; status: string } | undefined> {
    const open = notInArray(tickets.status, ['closed', 'cancelled']);
    const incidentOf = async (where: ReturnType<typeof and>) => {
      const [row] = await tx
        .select({ id: tickets.id, code: tickets.code, status: tickets.status })
        .from(alarms)
        .innerJoin(tickets, eq(tickets.id, alarms.ticketId))
        .where(and(where, open, inArray(tickets.status, [...OPEN])))
        .orderBy(tickets.createdAt)
        .limit(1);
      return row;
    };
    if (e.correlationId) {
      const byCorrelation = await incidentOf(eq(alarms.correlationId, e.correlationId));
      if (byCorrelation) return byCorrelation;
    }
    const related = [e.elementCode, e.parentElementCode].filter((x): x is string => !!x);
    return incidentOf(
      or(
        inArray(alarms.elementCode, related),
        // An alarm on the element feeding earlier alarms is the same fault seen from upstream.
        eq(alarms.parentElementCode, e.elementCode)
      )
    );
  }

  /** Keeps the incident's severity, priority and affected customers at the worst of its alarms. */
  private async updateIncident(tx: Tx, ticketId: string, e: NmsAlarmEvent): Promise<void> {
    const [t] = await tx
      .select({
        severity: tickets.severity,
        priority: tickets.priority,
        customers: tickets.customersAffected
      })
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    if (!t) return;
    const changes: Partial<typeof tickets.$inferInsert> = {};
    if (e.severity !== 'warning' && RANK[e.severity] > RANK[t.severity ?? 'warning']) {
      changes.severity = e.severity;
      changes.priority = Math.min(t.priority, SEVERITY_RULES[e.severity].priority);
    }
    if (e.customersAffected !== undefined && e.customersAffected > (t.customers ?? 0)) {
      changes.customersAffected = e.customersAffected;
    }
    if (Object.keys(changes).length) {
      await tx
        .update(tickets)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
    }
  }

  private async codeOf(tx: Tx, ticketId: string | null): Promise<string | null> {
    if (!ticketId) return null;
    const [t] = await tx.select({ code: tickets.code }).from(tickets).where(eq(tickets.id, ticketId));
    return t?.code ?? null;
  }
}
