import {
  NETWORK_REPORT_TYPES,
  PROBLEM_TYPES,
  type CreatedTicketView,
  type CustomerMatch,
  type NetworkReportType,
  type OfficeTicket,
  type ProblemType,
  type TicketPreview,
  type TicketPreviewInput
} from '../types';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  HelpCircle,
  Home as HomeIcon,
  Info,
  MessageSquare,
  Search,
  ShieldAlert,
  User,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { LocationPicker } from '../components/LocationPicker';
import { useCrumbs } from '../components/ui';
import { formatTime, STATUS_LABEL } from '../format';

type Caller = 'customer' | 'public';

interface Draft {
  caller: Caller;
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
  caller: 'customer',
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
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : null;
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
const QUICK_ADD: Record<Caller, string[]> = {
  customer: ['Breaker checked', 'Meter shows credit', 'Sparks or smoke seen', 'Neighbours have power'],
  public: ['Children nearby', 'Road blocked', 'Still sparking']
};

const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`);
const km = (m: number | null) =>
  m === null ? null : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
/** "by 12:51 today" in Maputo time, like every other time in the app. */
const byTime = (iso: string) => {
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Africa/Maputo' });
  const d = new Date(iso);
  if (day(d) === day(new Date())) return `by ${formatTime(iso)} today`;
  return `by ${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Africa/Maputo' })} ${formatTime(iso)}`;
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

function CustomerSearch({ onPick }: { onPick: (c: CustomerMatch) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const results = useQuery({
    queryKey: ['customer-lookup', q],
    queryFn: () => api<CustomerMatch[]>(`/customers/lookup?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 3
  });
  return (
    <div className="field">
      <label htmlFor="caller-search">Phone, contract or meter number</label>
      <div className="search-field" style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: 14, top: 14, color: 'var(--muted)' }} />
        <input
          id="caller-search"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 40217735 or 84 111 0001"
          style={{ width: '100%', paddingLeft: 42 }}
        />
      </div>
      {q.length >= 3 && results.data && (
        <div className="choices" role="group" aria-label="Customers found" style={{ padding: 0 }}>
          {results.data.length === 0 && (
            <div className="meta">No customer found. Check the number, or try the name.</div>
          )}
          {results.data.map((c) => (
            <button key={c.id} type="button" className="choice" onClick={() => onPick(c)}>
              <User size={20} aria-hidden />
              <span className="grow">
                <strong>{c.fullName}</strong>
                <div className="meta">
                  {[
                    c.contractNo && `Contract ${c.contractNo}`,
                    c.meterNumber && `meter ${c.meterNumber}`,
                    c.address,
                    c.teamName && `team ${c.teamName}`
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** W05: someone at EDM takes a call themselves and enters the ticket, in three short steps. */
export function NewTicketPage() {
  useCrumbs([{ label: 'All tickets', to: '/tickets' }, { label: 'New ticket' }]);
  const navigate = useNavigate();
  const [restored] = useState(loadDraft);
  const [d, setD] = useState<Draft>(restored ?? EMPTY);
  const [draftNote, setDraftNote] = useState<string | null>(restored ? 'Draft restored.' : null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const previewInput: TicketPreviewInput | null =
    d.caller === 'customer'
      ? d.customer && d.problemType
        ? {
            caller: 'customer',
            customerId: d.customer.id,
            problemType: d.problemType,
            priority: d.problemType === 'other' ? (d.priority ?? undefined) : undefined
          }
        : null
      : d.reportType
        ? { caller: 'public', reportType: d.reportType, location: d.location ?? undefined }
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
      if (d.caller === 'customer') {
        if (!d.customer) throw new Error('Find the customer first.');
        if (!d.problemType) throw new Error('Choose what the problem is.');
        if (d.problemType === 'other' && !d.priority)
          throw new Error('Choose a priority for "Something else".');
        body = {
          caller: 'customer',
          customerId: d.customer.id,
          problemType: d.problemType,
          priority: d.problemType === 'other' ? (d.priority ?? undefined) : undefined,
          description: d.description.trim(),
          callerPhone: d.callerPhone.trim() || undefined,
          joinIncident: d.joinIncident !== false
        };
      } else {
        if (!d.reportType) throw new Error('Choose what the caller sees.');
        if (d.address.trim().length < 3) throw new Error('Write where it is.');
        body = {
          caller: 'public',
          reportType: d.reportType,
          address: d.address.trim(),
          location: d.location ?? undefined,
          description: d.description.trim(),
          callerName: d.callerName.trim() || undefined,
          callerPhone: d.callerPhone.trim() || undefined
        };
      }
      if (body.description.length < 3) throw new Error('Write what the caller says.');
      return api<CreatedTicketView>('/tickets', { method: 'POST', body });
    },
    onSuccess: (t) => {
      storeDraft(null);
      navigate(`/tickets/${t.id}`);
    }
  });

  const quickAdd = (text: string) =>
    set({ description: d.description.trim() ? `${d.description.trim()} ${text}.` : `${text}.` });
  const smsText = p?.sms ? (joining ? p.sms.knownOutage : p.sms.newJob) : null;
  const hasPhone =
    d.caller === 'customer' ? !!(d.callerPhone.trim() || d.customer?.phone) : !!d.callerPhone.trim();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>New ticket</h1>
          <div className="subtitle">
            Three short steps. The right team is picked for you and the caller gets an SMS.
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
            Start again
          </button>
        </div>
      )}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 420px)' }}>
        <div className="stack">
          <Step n={1} title="Who is calling?">
            <div className="segmented" role="radiogroup" aria-label="Caller">
              <button
                type="button"
                aria-pressed={d.caller === 'customer'}
                onClick={() => set({ caller: 'customer', joinIncident: null })}
              >
                EDM customer · 1455
              </button>
              <button
                type="button"
                aria-pressed={d.caller === 'public'}
                onClick={() => set({ caller: 'public', joinIncident: null })}
              >
                Member of the public · 800 145 145
              </button>
            </div>
            {d.caller === 'customer' &&
              (d.customer ? (
                <div className="note" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <CheckCircle2 size={22} color="var(--brand-text)" aria-hidden />
                  <div style={{ flex: 1 }}>
                    <strong>{d.customer.fullName}</strong>
                    <div className="meta">
                      {[
                        d.customer.contractNo && `Contract ${d.customer.contractNo}`,
                        d.customer.meterNumber && `meter ${d.customer.meterNumber}`,
                        d.customer.address,
                        d.customer.teamName && `team ${d.customer.teamName}`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {d.customer.openTickets.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        Already open for this customer:{' '}
                        {d.customer.openTickets.slice(0, 3).map((t, i) => (
                          <span key={t.id}>
                            {i > 0 && ', '}
                            <Link to={`/tickets/${t.id}`}>
                              {t.code} {t.title}
                            </Link>{' '}
                            ({STATUS_LABEL[t.status]})
                          </span>
                        ))}
                        {d.customer.openTickets.length > 3 && (
                          <>
                            {' '}
                            and{' '}
                            <Link
                              to={`/tickets?view=all&q=${encodeURIComponent(d.customer.contractNo ?? d.customer.fullName)}`}
                            >
                              {d.customer.openTickets.length - 3} more
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
                    Change
                  </button>
                </div>
              ) : (
                <CustomerSearch onPick={(customer) => set({ customer, joinIncident: null })} />
              ))}
            {d.caller === 'public' && (
              <>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="caller-name">Caller’s name (optional)</label>
                    <input
                      id="caller-name"
                      value={d.callerName}
                      onChange={(e) => set({ callerName: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="caller-phone">Caller’s phone (optional, for the SMS)</label>
                    <input
                      id="caller-phone"
                      inputMode="tel"
                      value={d.callerPhone}
                      onChange={(e) => set({ callerPhone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="address">Where is it?</label>
                  <input
                    id="address"
                    value={d.address}
                    onChange={(e) => set({ address: e.target.value })}
                    placeholder="Street, landmark, neighbourhood"
                  />
                </div>
                <div className="field">
                  <span className="label">
                    Mark the place on the map, so the nearest team is sent{d.location ? '' : ' (optional)'}
                  </span>
                  <LocationPicker value={d.location} onChange={(location) => set({ location })} />
                </div>
              </>
            )}
          </Step>

          <Step n={2} title="What is the problem?">
            <div className="tiles" role="radiogroup" aria-label="Problem">
              {d.caller === 'customer'
                ? (Object.keys(PROBLEM_TYPES) as ProblemType[]).map((k) => (
                    <Tile
                      key={k}
                      selected={d.problemType === k}
                      icon={PROBLEM_ICON[k]}
                      title={k === 'other' ? 'Something else' : PROBLEM_TYPES[k].label}
                      note={
                        k === 'other'
                          ? 'Choose priority'
                          : `Priority ${PROBLEM_TYPES[k].priority} · ${hours(PROBLEM_TYPES[k].slaMinutes)}`
                      }
                      onPick={() => set({ problemType: k, joinIncident: null })}
                    />
                  ))
                : (Object.keys(NETWORK_REPORT_TYPES) as NetworkReportType[]).map((k) => (
                    <Tile
                      key={k}
                      selected={d.reportType === k}
                      icon={REPORT_ICON[k]}
                      title={NETWORK_REPORT_TYPES[k].label}
                      note={`Priority ${NETWORK_REPORT_TYPES[k].priority} · ${hours(NETWORK_REPORT_TYPES[k].slaMinutes)}`}
                      onPick={() => set({ reportType: k })}
                    />
                  ))}
            </div>
            {d.caller === 'customer' && d.problemType === 'other' && (
              <div className="field">
                <span className="label">Priority</span>
                <div className="segmented" role="radiogroup" aria-label="Priority">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={d.priority === n}
                      onClick={() => set({ priority: n })}
                    >
                      {n === 1 ? '1 · urgent, 2 h' : n === 2 ? '2 · 4 h' : '3 · 24 h'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="description">What the caller says</label>
              <textarea
                id="description"
                rows={4}
                value={d.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <span className="meta">Quick add:</span>
              {QUICK_ADD[d.caller].map((q) => (
                <button key={q} type="button" className="btn btn-sm" onClick={() => quickAdd(q)}>
                  + {q}
                </button>
              ))}
            </div>
            {d.caller === 'customer' && (
              <div className="field">
                <label htmlFor="callback-phone">Call-back phone, if not the customer’s own (optional)</label>
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

          <Step n={3} title="Check before creating">
            {!p ? (
              <div className="meta">
                {d.caller === 'customer'
                  ? 'Find the customer and choose the problem first.'
                  : 'Choose the problem first.'}
              </div>
            ) : p.incident && d.caller === 'customer' ? (
              <div className="incident-check" role="group" aria-label="Same problem as an open incident?">
                <Info size={20} aria-hidden />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <strong>Is this the same problem?</strong> Incident{' '}
                    <Link to={`/tickets/${p.incident.id}`}>{p.incident.code}</Link> is already open near this
                    customer{p.incident.elementName ? `, on ${p.incident.elementName}` : ''}.{' '}
                    {p.incident.linkedCustomers === 0
                      ? 'No other customer has called yet.'
                      : `${p.incident.linkedCustomers} other ${p.incident.linkedCustomers === 1 ? 'customer has' : 'customers have'} called.`}
                  </div>
                  <div className="btn-row">
                    <button
                      type="button"
                      className={d.joinIncident !== false ? 'btn btn-blue' : 'btn'}
                      aria-pressed={d.joinIncident !== false}
                      onClick={() => set({ joinIncident: true })}
                    >
                      Yes, add caller to incident
                    </button>
                    <button
                      type="button"
                      className={d.joinIncident === false ? 'btn btn-blue' : 'btn'}
                      aria-pressed={d.joinIncident === false}
                      onClick={() => set({ joinIncident: false })}
                    >
                      No, it is different
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="meta" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <CheckCircle2 size={18} color="var(--ok)" aria-hidden />
                {d.caller === 'customer'
                  ? 'No open network incident near this customer.'
                  : p.team
                    ? `The place is in ${p.areaName ?? 'the area'} of team ${p.team.name}.`
                    : 'No place marked, or outside the team areas: NOC will route it.'}
              </div>
            )}
          </Step>
        </div>

        <aside className="card card-pad" style={{ gap: 18, position: 'sticky', top: 88 }}>
          <h2 style={{ margin: 0 }}>What happens next</h2>
          {!p ? (
            <div className="meta">Shown here once the caller and the problem are chosen.</div>
          ) : (
            <>
              <div className="next-item">
                <span className="next-icon">
                  <User size={18} />
                </span>
                <div>
                  {joining ? (
                    <>
                      <strong>Joins incident {p.incident!.code}</strong>
                      <div className="meta">The crew on the incident fixes it; nobody else is sent.</div>
                    </>
                  ) : p.assignee ? (
                    <>
                      <strong>Sent to {p.assignee.fullName}</strong>
                      <div className="meta">
                        {[
                          p.team && `Team ${p.team.name}`,
                          km(p.assignee.distanceM) && `nearest, ${km(p.assignee.distanceM)}`,
                          p.assignee.openJobs === 0 ? 'free now' : `${p.assignee.openJobs} jobs open`
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </>
                  ) : p.team ? (
                    <>
                      <strong>Waits for the manager of team {p.team.name}</strong>
                      <div className="meta">Nobody of the team is on duty; the manager gets an SMS.</div>
                    </>
                  ) : (
                    <>
                      <strong>No team yet</strong>
                      <div className="meta">NOC sends it to the right team.</div>
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
                    <strong>Fixed within {hours(p.slaMinutes)}</strong>
                    <div className="meta">{byTime(p.dueAt)}</div>
                  </div>
                </div>
              )}
              <div className="next-item">
                <span className="next-icon">
                  <MessageSquare size={18} />
                </span>
                <div style={{ flex: 1 }}>
                  <strong>{hasPhone ? 'Caller gets an SMS' : 'No SMS: no phone number'}</strong>
                  {hasPhone && smsText && <div className="sms-preview">{smsText}</div>}
                </div>
              </div>
            </>
          )}
          {create.error && <div className="error">{(create.error as Error).message}</div>}
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create ticket'}
          </button>
          <button
            type="button"
            className="btn btn-lg"
            onClick={() => {
              storeDraft(d);
              setDraftNote('Draft saved on this computer. It is here when you come back to New ticket.');
            }}
          >
            Save as draft
          </button>
        </aside>
      </div>
    </div>
  );
}
