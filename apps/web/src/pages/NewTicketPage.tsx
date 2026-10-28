import {
  NETWORK_REPORT_TYPES,
  PROBLEM_TYPES,
  type CreatedTicketView,
  type CustomerMatch,
  type Lookups,
  type NetworkReportType,
  type OfficeTicket,
  type ProblemType,
  type TicketPreview,
  type TicketPreviewInput,
  type TicketType
} from '../types';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  HelpCircle,
  Home as HomeIcon,
  Info,
  MessageSquare,
  PlugZap,
  ShieldAlert,
  User,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { CustomerSearch } from '../components/CustomerSearch';
import { LocationPicker } from '../components/LocationPicker';
import { useMapAddress } from '../components/mapAddress';
import { ConnectionForm, SurveyForm } from '../components/NewCustomerForms';
import { creatableTypes, useCrumbs, useMe } from '../components/ui';
import { formatTime, STATUS_LABEL, ticketTitle } from '../format';
import { t, dateLocale } from '../i18n';
import { PlanForm } from './PlannedWorkPage';

/** The types typed in over three steps here; the others have a form of their own. */
type CallType = 'customer_complaint' | 'network_incident' | 'other';
const isCallType = (type: TicketType): type is CallType =>
  type === 'customer_complaint' || type === 'network_incident' || type === 'other';

interface Draft {
  type: TicketType;
  title: string;
  customer: CustomerMatch | null;
  problemType: ProblemType | null;
  priority: number | null;
  reportType: NetworkReportType | null;
  address: string;
  location: { lat: number; lng: number } | null;
  callerName: string;
  callerPhone: string;
  description: string;
  joinIncident: boolean | null;
}

const EMPTY: Draft = {
  type: 'customer_complaint',
  title: '',
  customer: null,
  problemType: null,
  priority: null,
  reportType: null,
  address: '',
  location: null,
  callerName: '',
  callerPhone: '',
  description: '',
  joinIncident: null
};

/** "Save as draft" keeps the form on this computer only, for a call that has to be finished later. */
const DRAFT_KEY = 'edm.newTicketDraft';
function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const saved = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : null;
    return saved && isCallType(saved.type) ? saved : null;
  } catch {
    return null;
  }
}
function storeDraft(d: Draft | null): void {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private windows may refuse storage; the draft is then only lost on leaving the page.
  }
}

const PROBLEM_ICON: Record<ProblemType, LucideIcon> = {
  no_power_single: HomeIcon,
  no_power_street: Building2,
  low_voltage: Activity,
  prepaid_meter: FileText,
  cable_down: AlertTriangle,
  other: HelpCircle
};
const REPORT_ICON: Record<NetworkReportType, LucideIcon> = {
  cable_down: AlertTriangle,
  transformer_fault: Zap,
  sparks: Flame,
  pole_damaged: ShieldAlert,
  theft_vandalism: ShieldAlert,
  other: HelpCircle
};
const QUICK_ADD: Record<CallType, string[]> = {
  customer_complaint: [
    'Breaker checked',
    'Meter shows credit',
    'Sparks or smoke seen',
    'Neighbours have power'
  ],
  network_incident: ['Children nearby', 'Road blocked', 'Still sparking'],
  other: []
};

const TYPE_TILE: Record<TicketType, { icon: LucideIcon; title: string; note: string }> = {
  customer_complaint: {
    icon: User,
    title: 'Customer complaint',
    note: 'An EDM customer calls about their supply (1455)'
  },
  network_incident: {
    icon: Zap,
    title: 'Network incident',
    note: 'Someone reports a network problem (800 145 145)'
  },
  planned_work: {
    icon: Wrench,
    title: 'Maintenance / network change',
    note: 'Maintenance or a network change, planned ahead'
  },
  new_customer_survey: {
    icon: HomeIcon,
    title: 'New customer survey',
    note: 'Survey before a sale, without the Sales system'
  },
  new_connection: {
    icon: PlugZap,
    title: 'New connection',
    note: 'Build a connection after the contract, without the Sales system'
  },
  other: { icon: HelpCircle, title: 'Other', note: 'Anything else that comes up' }
};
/** What happens to a ticket made with its own form. */
const NEXT_FOR: Partial<Record<TicketType, string[]>> = {
  planned_work: [
    'The team manager assigns it to a staff member.',
    'The time limit is the end of the planned work.',
    'NOC checks the network and closes it.'
  ],
  new_customer_survey: [
    'The team of the area gets it and visits the premises.',
    'The customer gets an SMS.',
    'The survey closes when the report is sent.'
  ],
  new_connection: [
    'The team of the area gets it; the material estimate of the survey is set aside.',
    'The customer confirms the handover with an SMS code or a signed form.',
    'The Call Center checks with the customer, then it is closed in Closing checks.'
  ]
};

function PriorityPicker({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <span className="label">{t('Priority')}</span>
      <div className="segmented" role="radiogroup" aria-label={t('Priority')}>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)}>
            {n === 1 ? t('1 · urgent, 2 h') : n === 2 ? '2 · 4 h' : '3 · 24 h'}
          </button>
        ))}
      </div>
    </div>
  );
}

const hours = (minutes: number) =>
  minutes < 60 ? t('{0} min', { 0: minutes }) : `${Math.round(minutes / 60)} h`;
const km = (m: number | null) =>
  m === null ? null : m < 1000 ? `${Math.round(m)} m` : t('{0} km', { 0: (m / 1000).toFixed(1) });
/** "by 12:51 today" in Maputo time, like every other time in the app. */
const byTime = (iso: string) => {
  const day = (d: Date) => d.toLocaleDateString(dateLocale(), { timeZone: 'Africa/Maputo' });
  const d = new Date(iso);
  if (day(d) === day(new Date())) return t('by {0} today', { 0: formatTime(iso) });
  return t('by {0} {1}', {
    0: d.toLocaleDateString(dateLocale(), { weekday: 'short', timeZone: 'Africa/Maputo' }),
    1: formatTime(iso)
  });
};

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="card card-pad" style={{ gap: 18 }}>
      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 14, fontSize: 21 }}>
        <span className="step-num" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Tile({
  selected,
  icon: Icon,
  title,
  note,
  onPick
}: {
  selected: boolean;
  icon: LucideIcon;
  title: string;
  note: string;
  onPick: () => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="tile" onClick={onPick}>
      <Icon size={22} aria-hidden />
      <strong>{title}</strong>
      <span className="meta">{note}</span>
    </button>
  );
}

/** W05: someone at EDM enters a ticket: first its type, then a few short steps for that type. */
export function NewTicketPage() {
  useCrumbs([{ label: t('All tickets'), to: '/tickets' }, { label: t('New ticket') }]);
  const navigate = useNavigate();
  const me = useMe();
  const allowed = creatableTypes(me.data);
  const [restored] = useState(loadDraft);
  const [d, setD] = useState<Draft>(restored ?? EMPTY);
  const [draftNote, setDraftNote] = useState<string | null>(restored ? t('Draft restored.') : null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const mapAddress = useMapAddress(d.address, (address) => set({ address }));
  // The first type this person may create, until they choose.
  const type: TicketType = allowed.includes(d.type) ? d.type : (allowed[0] ?? d.type);
  const call = isCallType(type) ? type : null;
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: type === 'planned_work'
  });

  const previewInput: TicketPreviewInput | null =
    call === 'customer_complaint'
      ? d.customer && d.problemType
        ? {
            type: call,
            customerId: d.customer.id,
            problemType: d.problemType,
            priority: d.problemType === 'other' ? (d.priority ?? undefined) : undefined
          }
        : null
      : call === 'network_incident'
        ? d.reportType
          ? { type: call, reportType: d.reportType, location: d.location ?? undefined }
          : null
        : call === 'other' && d.priority
          ? {
              type: call,
              priority: d.priority,
              customerId: d.customer?.id,
              location: d.location ?? undefined
            }
          : null;
  const preview = useQuery({
    queryKey: ['ticket-preview', previewInput],
    queryFn: () => api<TicketPreview>('/tickets/preview', { method: 'POST', body: previewInput }),
    enabled: !!previewInput,
    refetchInterval: 30_000
  });
  const p = preview.data;
  const joining = !!p?.incident && d.joinIncident !== false;

  const create = useMutation({
    mutationFn: () => {
      let body: OfficeTicket;
      if (call === 'customer_complaint') {
        if (!d.customer) throw new Error(t('Find the customer first.'));
        if (!d.problemType) throw new Error(t('Choose what the problem is.'));
        if (d.problemType === 'other' && !d.priority)
          throw new Error(t('Choose a priority for "Something else".'));
        body = {
          type: call,
          customerId: d.customer.id,
          problemType: d.problemType,
          priority: d.problemType === 'other' ? (d.priority ?? undefined) : undefined,
          description: d.description.trim(),
          callerPhone: d.callerPhone.trim() || undefined,
          joinIncident: d.joinIncident !== false
        };
      } else if (call === 'network_incident') {
        if (!d.reportType) throw new Error(t('Choose what the caller sees.'));
        if (d.address.trim().length < 3) throw new Error(t('Write where it is.'));
        body = {
          type: call,
          reportType: d.reportType,
          address: d.address.trim(),
          location: d.location ?? undefined,
          description: d.description.trim(),
          callerName: d.callerName.trim() || undefined,
          callerPhone: d.callerPhone.trim() || undefined
        };
      } else {
        if (d.title.trim().length < 3) throw new Error(t('Write what it is about.'));
        if (!d.priority) throw new Error(t('Choose the priority.'));
        body = {
          type: 'other',
          title: d.title.trim(),
          description: d.description.trim(),
          priority: d.priority,
          customerId: d.customer?.id,
          address: d.address.trim() || undefined,
          location: d.location ?? undefined,
          callerPhone: d.callerPhone.trim() || undefined
        };
      }
      if (body.description.length < 3)
        throw new Error(
          call === 'other' ? t('Write what needs to be done.') : t('Write what the caller says.')
        );
      return api<CreatedTicketView>('/tickets', { method: 'POST', body });
    },
    onSuccess: (t) => {
      storeDraft(null);
      navigate(`/tickets/${t.id}`);
    }
  });
  const opened = (created: { id: string }) => navigate(`/tickets/${created.id}`);

  const quickAdd = (text: string) =>
    set({ description: d.description.trim() ? `${d.description.trim()} ${text}.` : `${text}.` });
  const smsText = p?.sms ? (joining ? p.sms.knownOutage : p.sms.newJob) : null;
  const hasPhone =
    call === 'network_incident' ? !!d.callerPhone.trim() : !!(d.callerPhone.trim() || d.customer?.phone);

  const customerCard = (customer: CustomerMatch) => (
    <div className="note" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <CheckCircle2 size={22} color="var(--brand-text)" aria-hidden />
      <div style={{ flex: 1 }}>
        <strong>{customer.fullName}</strong>
        <div className="meta">
          {[
            customer.contractNo && t('Contract {0}', { 0: customer.contractNo }),
            customer.meterNumber && t('meter {0}', { 0: customer.meterNumber }),
            customer.address,
            customer.teamName && t('team {0}', { 0: customer.teamName })
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {customer.openTickets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {t('Already open for this customer:')}{' '}
            {customer.openTickets.slice(0, 3).map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link to={`/tickets/${t.id}`}>
                  {t.code} {ticketTitle(t.title)}
                </Link>{' '}
                ({STATUS_LABEL[t.status]})
              </span>
            ))}
            {customer.openTickets.length > 3 && (
              <>
                {' '}
                {t('and')}{' '}
                <Link
                  to={`/tickets?view=all&q=${encodeURIComponent(customer.contractNo ?? customer.fullName)}`}
                >
                  {customer.openTickets.length - 3} {t('more')}
                </Link>
              </>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => set({ customer: null, joinIncident: null })}
      >
        {t('Change')}
      </button>
    </div>
  );

  const placeFields = (optional: boolean) => (
    <>
      <div className="field">
        <label htmlFor="address">
          {t('Where is it?')}
          {optional ? t(' (optional)') : ''}
        </label>
        <input
          id="address"
          value={d.address}
          onChange={(e) => set({ address: e.target.value })}
          placeholder={t('Street, landmark, neighbourhood')}
        />
        {mapAddress.hint}
      </div>
      <div className="field">
        <span className="label">
          {t('Mark the place on the map, so the nearest team is sent')}
          {d.location ? '' : t(' (optional)')}
        </span>
        <LocationPicker
          value={d.location}
          onChange={(location) => {
            set({ location });
            mapAddress.placed(location);
          }}
        />
      </div>
    </>
  );

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('New ticket')}</h1>
          <div className="subtitle">
            {t('Choose the type, then a few short steps. The right team is picked for you.')}
          </div>
        </div>
      </div>
      {draftNote && (
        <div className="notice" role="status" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>{draftNote}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              storeDraft(null);
              setD(EMPTY);
              setDraftNote(null);
            }}
          >
            {t('Start again')}
          </button>
        </div>
      )}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 420px)' }}>
        <div className="stack">
          <Step n={1} title={t('Ticket type')}>
            <div className="tiles" role="radiogroup" aria-label={t('Ticket type')}>
              {allowed.map((k) => (
                <Tile
                  key={k}
                  selected={type === k}
                  icon={TYPE_TILE[k].icon}
                  title={t(TYPE_TILE[k].title)}
                  note={t(TYPE_TILE[k].note)}
                  onPick={() =>
                    set({ type: k, joinIncident: null, priority: null, problemType: null, reportType: null })
                  }
                />
              ))}
            </div>
          </Step>

          {type === 'planned_work' && lookups.data && <PlanForm lookups={lookups.data} onCreated={opened} />}
          {type === 'new_customer_survey' && <SurveyForm onCreated={opened} />}
          {type === 'new_connection' && <ConnectionForm onCreated={opened} />}

          {call === 'customer_complaint' && (
            <Step n={2} title={t('Who is calling?')}>
              {d.customer ? (
                customerCard(d.customer)
              ) : (
                <CustomerSearch onPick={(customer) => set({ customer, joinIncident: null })} />
              )}
            </Step>
          )}
          {call === 'network_incident' && (
            <Step n={2} title={t('Who is calling?')}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="caller-name">{t('Caller’s name (optional)')}</label>
                  <input
                    id="caller-name"
                    value={d.callerName}
                    onChange={(e) => set({ callerName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="caller-phone">{t('Caller’s phone (optional, for the SMS)')}</label>
                  <input
                    id="caller-phone"
                    inputMode="tel"
                    value={d.callerPhone}
                    onChange={(e) => set({ callerPhone: e.target.value })}
                  />
                </div>
              </div>
              {placeFields(false)}
            </Step>
          )}
          {call === 'other' && (
            <Step n={2} title={t('What is it about?')}>
              <div className="field">
                <label htmlFor="other-title">{t('Short title')}</label>
                <input
                  id="other-title"
                  value={d.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder={t('e.g. Meter box door broken')}
                />
              </div>
              <div className="field">
                <span className="label">{t('Customer (optional)')}</span>
                {d.customer ? (
                  customerCard(d.customer)
                ) : (
                  <CustomerSearch onPick={(customer) => set({ customer })} />
                )}
              </div>
              {placeFields(true)}
            </Step>
          )}

          {call && (
            <Step n={3} title={call === 'other' ? t('Priority and details') : t('What is the problem?')}>
              {call !== 'other' && (
                <div className="tiles" role="radiogroup" aria-label={t('Problem')}>
                  {call === 'customer_complaint'
                    ? (Object.keys(PROBLEM_TYPES) as ProblemType[]).map((k) => (
                        <Tile
                          key={k}
                          selected={d.problemType === k}
                          icon={PROBLEM_ICON[k]}
                          title={k === 'other' ? t('Something else') : t(PROBLEM_TYPES[k].label)}
                          note={
                            k === 'other'
                              ? t('Choose priority')
                              : t('Priority {0} · {1}', {
                                  0: PROBLEM_TYPES[k].priority,
                                  1: hours(PROBLEM_TYPES[k].slaMinutes)
                                })
                          }
                          onPick={() => set({ problemType: k, joinIncident: null })}
                        />
                      ))
                    : (Object.keys(NETWORK_REPORT_TYPES) as NetworkReportType[]).map((k) => (
                        <Tile
                          key={k}
                          selected={d.reportType === k}
                          icon={REPORT_ICON[k]}
                          title={t(NETWORK_REPORT_TYPES[k].label)}
                          note={t('Priority {0} · {1}', {
                            0: NETWORK_REPORT_TYPES[k].priority,
                            1: hours(NETWORK_REPORT_TYPES[k].slaMinutes)
                          })}
                          onPick={() => set({ reportType: k })}
                        />
                      ))}
                </div>
              )}
              {((call === 'customer_complaint' && d.problemType === 'other') || call === 'other') && (
                <PriorityPicker value={d.priority} onChange={(priority) => set({ priority })} />
              )}
              <div className="field">
                <label htmlFor="description">
                  {call === 'other' ? t('What needs to be done') : t('What the caller says')}
                </label>
                <textarea
                  id="description"
                  rows={4}
                  value={d.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </div>
              {QUICK_ADD[call].length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <span className="meta">{t('Quick add:')}</span>
                  {QUICK_ADD[call]
                    .map((q) => t(q))
                    .map((q) => (
                      <button key={q} type="button" className="btn btn-sm" onClick={() => quickAdd(q)}>
                        + {q}
                      </button>
                    ))}
                </div>
              )}
              {call !== 'network_incident' && (
                <div className="field">
                  <label htmlFor="callback-phone">
                    {call === 'other'
                      ? t('Phone for the SMS updates (optional)')
                      : t('Call-back phone, if not the customer’s own (optional)')}
                  </label>
                  <input
                    id="callback-phone"
                    inputMode="tel"
                    value={d.callerPhone}
                    onChange={(e) => set({ callerPhone: e.target.value })}
                    placeholder={d.customer?.phone ?? ''}
                  />
                </div>
              )}
            </Step>
          )}

          {call && (
            <Step n={4} title={t('Check before creating')}>
              {!p ? (
                <div className="meta">
                  {call === 'customer_complaint'
                    ? t('Find the customer and choose the problem first.')
                    : call === 'other'
                      ? t('Choose the priority first.')
                      : t('Choose the problem first.')}
                </div>
              ) : p.incident && call === 'customer_complaint' ? (
                <div
                  className="incident-check"
                  role="group"
                  aria-label={t('Same problem as an open incident?')}
                >
                  <Info size={20} aria-hidden />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <strong>{t('Is this the same problem?')}</strong> {t('Incident')}{' '}
                      <Link to={`/tickets/${p.incident.id}`}>{p.incident.code}</Link>{' '}
                      {t('is already open near this customer')}
                      {p.incident.elementName ? t(', on {0}', { 0: p.incident.elementName }) : ''}.{' '}
                      {p.incident.linkedCustomers === 0
                        ? t('No other customer has called yet.')
                        : t(
                            p.incident.linkedCustomers === 1
                              ? '{0} other customer has called.'
                              : '{0} other customers have called.',
                            { 0: p.incident.linkedCustomers }
                          )}
                    </div>
                    <div className="btn-row">
                      <button
                        type="button"
                        className={d.joinIncident !== false ? 'btn btn-blue' : 'btn'}
                        aria-pressed={d.joinIncident !== false}
                        onClick={() => set({ joinIncident: true })}
                      >
                        {t('Yes, add caller to incident')}
                      </button>
                      <button
                        type="button"
                        className={d.joinIncident === false ? 'btn btn-blue' : 'btn'}
                        aria-pressed={d.joinIncident === false}
                        onClick={() => set({ joinIncident: false })}
                      >
                        {t('No, it is different')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="meta" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <CheckCircle2 size={18} color="var(--ok)" aria-hidden />
                  {call === 'customer_complaint'
                    ? t('No open network incident near this customer.')
                    : p.team
                      ? t('The place is in {0} of team {1}.', { 0: p.areaName ?? 'the area', 1: p.team.name })
                      : t('No place marked, or outside the team areas: NOC will route it.')}
                </div>
              )}
            </Step>
          )}
        </div>

        <aside className="card card-pad" style={{ gap: 18, position: 'sticky', top: 88 }}>
          <h2 style={{ margin: 0 }}>{t('What happens next')}</h2>
          {!call ? (
            (NEXT_FOR[type] ?? []).map((line, i) => (
              <div key={line} className="next-item">
                <span className="next-icon">
                  {i === 0 ? (
                    <User size={18} />
                  ) : i === 1 ? (
                    <CalendarDays size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                </span>
                <div>{t(line)}</div>
              </div>
            ))
          ) : !p ? (
            <div className="meta">{t('Shown here once the steps on the left are filled in.')}</div>
          ) : (
            <>
              <div className="next-item">
                <span className="next-icon">
                  <User size={18} />
                </span>
                <div>
                  {joining ? (
                    <>
                      <strong>
                        {t('Joins incident')} {p.incident!.code}
                      </strong>
                      <div className="meta">
                        {t('The crew on the incident fixes it; nobody else is sent.')}
                      </div>
                    </>
                  ) : p.assignee ? (
                    <>
                      <strong>
                        {t('Sent to')} {p.assignee.fullName}
                      </strong>
                      <div className="meta">
                        {[
                          p.team && t('Team {0}', { 0: p.team.name }),
                          km(p.assignee.distanceM) && t('nearest, {0}', { 0: km(p.assignee.distanceM) }),
                          p.assignee.openJobs === 0
                            ? t('free now')
                            : t('{0} jobs open', { 0: p.assignee.openJobs })
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </>
                  ) : p.team ? (
                    <>
                      <strong>
                        {t('Waits for the manager of team')} {p.team.name}
                      </strong>
                      <div className="meta">
                        {t('Nobody of the team is on duty; the manager gets an SMS.')}
                      </div>
                    </>
                  ) : (
                    <>
                      <strong>{t('No team yet')}</strong>
                      <div className="meta">{t('NOC sends it to the right team.')}</div>
                    </>
                  )}
                </div>
              </div>
              {!joining && (
                <div className="next-item">
                  <span className="next-icon">
                    <Clock size={18} />
                  </span>
                  <div>
                    <strong>
                      {t('Fixed within')} {hours(p.slaMinutes)}
                    </strong>
                    <div className="meta">{byTime(p.dueAt)}</div>
                  </div>
                </div>
              )}
              <div className="next-item">
                <span className="next-icon">
                  <MessageSquare size={18} />
                </span>
                <div style={{ flex: 1 }}>
                  <strong>{hasPhone ? t('Caller gets an SMS') : t('No SMS: no phone number')}</strong>
                  {hasPhone && smsText && <div className="sms-preview">{smsText}</div>}
                </div>
              </div>
              {call === 'other' && (
                <div className="next-item">
                  <span className="next-icon">
                    <CheckCircle2 size={18} />
                  </span>
                  <div>{t('When it is done, the office checks it in Closing checks and closes it.')}</div>
                </div>
              )}
            </>
          )}
          {call && (
            <>
              {create.error && <div className="error">{(create.error as Error).message}</div>}
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? t('Creating…') : t('Create ticket')}
              </button>
              <button
                type="button"
                className="btn btn-lg"
                onClick={() => {
                  storeDraft({ ...d, type });
                  setDraftNote(
                    t('Draft saved on this computer. It is here when you come back to New ticket.')
                  );
                }}
              >
                {t('Save as draft')}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
