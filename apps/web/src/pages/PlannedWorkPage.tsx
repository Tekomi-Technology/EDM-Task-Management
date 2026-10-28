import type { Lookups, PlannedWorkItem, PlannedWorkKind, TicketDetail } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { hasRole, useCrumbs, useMe } from '../components/ui';
import { formatTime } from '../format';
import { useRegion } from '../components/topbar';
import { t, dateLocale } from '../i18n';

/** Mozambique is UTC+2 all year. */
const OFFSET = '+02:00';
const DAY = 24 * 3600_000;

function isoDay(d: Date): string {
  return new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

/** Monday of the week containing the date (Mozambique days). */
function monday(d: Date): Date {
  const local = new Date(`${isoDay(d)}T00:00:00${OFFSET}`);
  const weekday = (new Date(local.getTime() + 2 * 3600_000).getUTCDay() + 6) % 7;
  return new Date(local.getTime() - weekday * DAY);
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    timeZone: 'Africa/Maputo'
  });

/** Maintenance or a network change; also offered on the New ticket screen. */
export function PlanForm({ lookups, onCreated }: { lookups: Lookups; onCreated: (t: TicketDetail) => void }) {
  const tomorrow = isoDay(new Date(Date.now() + DAY));
  const [kind, setKind] = useState<PlannedWorkKind>('maintenance');
  const [title, setTitle] = useState('');
  const [element, setElement] = useState('');
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(tomorrow);
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('13:00');
  const [outage, setOutage] = useState(false);
  const [customers, setCustomers] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api<TicketDetail>('/planned-work', {
        method: 'POST',
        body: {
          kind,
          title: title.trim(),
          element: element.trim(),
          teamId,
          scheduledStart: `${date}T${from}:00${OFFSET}`,
          scheduledEnd: `${date}T${to}:00${OFFSET}`,
          outage,
          customersAffected: outage && customers ? Number(customers) : undefined,
          description: description.trim() || undefined
        }
      }),
    onSuccess: (t) => {
      onCreated(t);
      setTitle('');
      setElement('');
      setDescription('');
      setOutage(false);
      setCustomers('');
    }
  });
  const problem = !teamId
    ? t('Choose the team that will do it.')
    : to <= from
      ? t('The end must be after the start.')
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!problem) create.mutate();
  };

  return (
    <form
      className="card card-pad"
      style={{ gap: 16, padding: 28 }}
      onSubmit={submit}
      aria-label={t('Plan new work')}
    >
      <h2 style={{ fontSize: 22 }}>{t('Plan new work')}</h2>
      <div className="segmented">
        <button type="button" aria-pressed={kind === 'maintenance'} onClick={() => setKind('maintenance')}>
          {t('Maintenance')}
        </button>
        <button
          type="button"
          aria-pressed={kind === 'network_change'}
          onClick={() => setKind('network_change')}
        >
          {t('Network change')}
        </button>
      </div>
      <div className="field">
        <label htmlFor="p-title">{t('What needs to be done')}</label>
        <input
          id="p-title"
          required
          minLength={3}
          value={title}
          placeholder={t('e.g. Replace transformer PT-1180 (100 kVA → 250 kVA)')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-element">{t('Equipment or place')}</label>
          <input
            id="p-element"
            required
            value={element}
            placeholder={t('PT-1180 · Matola, Liberdade')}
            onChange={(e) => setElement(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p-team">{t('Team')}</label>
          <select id="p-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">{t('Choose a team…')}</option>
            {lookups.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.areaName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-date">{t('Date')}</label>
          <input
            id="p-date"
            type="date"
            required
            min={isoDay(new Date())}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div className="form-grid" style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="p-from">{t('From')}</label>
          <input id="p-from" type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-to">{t('To')}</label>
          <input id="p-to" type="time" required value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="box" style={{ gap: 10, padding: 18 }}>
        <label className="check" style={{ fontWeight: 700, fontSize: 15 }}>
          <input type="checkbox" checked={outage} onChange={(e) => setOutage(e.target.checked)} />{' '}
          {t('Power will be cut during the work')}
        </label>
        {outage && (
          <>
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="p-customers">{t('About how many customers?')}</label>
              <input
                id="p-customers"
                type="number"
                min={0}
                value={customers}
                onChange={(e) => setCustomers(e.target.value)}
              />
            </div>
            <span className="meta" style={{ fontSize: 14 }}>
              {t(
                "The Call Center sees planned cuts through its connection, so it can answer calls. Texting each affected customer needs EDM's list of customers per transformer (to be loaded later)."
              )}
            </span>
          </>
        )}
      </div>
      <div className="field">
        <label htmlFor="p-desc">{t('Notes for the team (optional)')}</label>
        <textarea id="p-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <span className="meta">
        {t('Materials to reserve from stock come with the stock module (phase 4).')}
      </span>
      {problem && <span className="meta">{problem}</span>}
      {create.error && <div className="error">{(create.error as ApiRequestError).message}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={create.isPending || !!problem}>
          {create.isPending ? t('Saving…') : t('Create planned job')}
        </button>
      </div>
    </form>
  );
}

/** W09: maintenance and network changes planned by the network team; the team manager assigns them. */
export function PlannedWorkPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: t('Tickets'), to: '/tickets' }, { label: t('Planned work') }]);
  const me = useMe();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [created, setCreated] = useState<TicketDetail | null>(null);
  const from = isoDay(weekStart);
  const to = isoDay(new Date(weekStart.getTime() + 6 * DAY));
  const work = useQuery({
    queryKey: ['planned', from, to, areaId],
    queryFn: () => api<PlannedWorkItem[]>(withArea(`/planned-work?from=${from}&to=${to}`))
  });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups') });
  const canPlan = hasRole(me.data, 'network_team', 'noc', 'admin', 'technical_manager');

  const byDay = new Map<string, PlannedWorkItem[]>();
  for (const w of work.data ?? []) {
    const d = isoDay(new Date(w.planned.scheduledStart));
    byDay.set(d, [...(byDay.get(d) ?? []), w]);
  }
  const rangeLabel = `${new Date(`${from}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })} – ${new Date(
    `${to}T12:00:00Z`
  ).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })}`;

  return (
    <div className="content">
      <div>
        <h1>{t('Planned work')}</h1>
        <div className="subtitle">{t('Maintenance and network changes planned by the network team.')}</div>
      </div>
      {created && (
        <div className="notice">
          {t('Planned job')} <Link to={`/tickets/${created.id}`}>{created.code}</Link> {t('created for team')}{' '}
          {created.teamName}
          {t('. The team manager assigns it.')}
        </div>
      )}
      <div
        className="two-col"
        style={{ gridTemplateColumns: canPlan ? 'minmax(300px, 460px) minmax(0, 1fr)' : '1fr' }}
      >
        <section className="card card-pad" style={{ gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h2>{t('Week')}</h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={t('Previous week')}
                onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="meta" style={{ fontSize: 14, minWidth: 110, textAlign: 'center' }}>
                {rangeLabel}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={t('Next week')}
                onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}
              >
                <ChevronRight size={16} />
              </button>
            </span>
          </div>
          {work.data && work.data.length === 0 && (
            <span className="meta">{t('Nothing planned this week.')}</span>
          )}
          {[...byDay.entries()].map(([day, items]) => (
            <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong style={{ color: 'var(--text-2)' }}>{dayLabel(items[0]!.planned.scheduledStart)}</strong>
              {items.map((w) => (
                <Link
                  key={w.id}
                  to={`/tickets/${w.id}`}
                  className="box"
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    borderLeft: `4px solid ${w.planned.outage ? 'var(--brand)' : '#2e6be6'}`
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{w.title}</strong>
                    <span className="meta">
                      {formatTime(w.planned.scheduledStart)}–{formatTime(w.planned.scheduledEnd)}
                    </span>
                  </span>
                  <span className="meta" style={{ fontSize: 14 }}>
                    {[
                      w.planned.element,
                      w.assignee?.fullName ?? (w.teamName ? t('Team {0}', { 0: w.teamName }) : null),
                      w.planned.outage
                        ? w.planned.customersAffected !== null
                          ? t('{0} customers off', { 0: w.planned.customersAffected })
                          : t('Power off')
                        : t('no outage'),
                      w.status === 'cancelled' ? t('cancelled') : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </section>
        {canPlan && lookups.data && (
          <PlanForm
            lookups={lookups.data}
            onCreated={(t) => {
              setCreated(t);
              void queryClient.invalidateQueries({ queryKey: ['planned'] });
            }}
          />
        )}
      </div>
    </div>
  );
}
