import {
  TICKET_SOURCES,
  TICKET_TYPES,
  type Lookups,
  type TicketCounts,
  type TicketSummary,
  type TicketView
} from '../types';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { AssigneeCell, creatableTypes, hasRole, OFFICE_ROLES, useCrumbs, useMe } from '../components/ui';
import { SOURCE_LABEL, STATUS_LABEL, timeCell, TYPE_LABEL, ticketTitle } from '../format';
import { useRegion } from '../components/topbar';
import { t as tr } from '../i18n';

const PAGE_SIZE = 20;

const TABS: { view: TicketView; label: string; count?: keyof TicketCounts }[] = [
  { view: 'active', label: 'All', count: 'active' },
  { view: 'unassigned', label: 'Nobody assigned', count: 'unassigned' },
  { view: 'late', label: 'Late or nearly late', count: 'late' },
  { view: 'waiting_check', label: 'Waiting for check', count: 'waiting_check' },
  { view: 'closed_today', label: 'Closed today', count: 'closed_today' },
  { view: 'closed', label: 'Closed & cancelled' },
  { view: 'all', label: 'Everything' }
];

type List = { items: TicketSummary[]; total: number };

/** Every ticket matching the filters (up to 5,000), as a CSV file Excel opens directly. */
async function exportCsv(params: URLSearchParams): Promise<void> {
  const rows: TicketSummary[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const p = new URLSearchParams(params);
    p.delete('page');
    p.set('limit', '100');
    p.set('offset', String(offset));
    const page = await api<List>(`/tickets?${p}`);
    rows.push(...page.items);
    if (rows.length >= page.total || page.items.length === 0) break;
  }
  const header = [
    tr('Code'),
    tr('Title'),
    tr('Type'),
    tr('From'),
    tr('Area'),
    tr('Team'),
    tr('Customer'),
    tr('Address'),
    tr('Assigned to'),
    tr('Status'),
    tr('Due'),
    tr('Created')
  ];
  const cell = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((t) =>
    [
      t.code,
      t.title,
      TYPE_LABEL[t.type],
      SOURCE_LABEL[t.source],
      t.areaName,
      t.teamName,
      t.customerName,
      t.address,
      t.assignee?.fullName,
      STATUS_LABEL[t.status],
      t.dueAt,
      t.createdAt
    ]
      .map(cell)
      .join(',')
  );
  // The byte-order mark makes Excel read accents (ç, ã) correctly.
  const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\r\n')], {
    type: 'text/csv;charset=utf-8'
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `edm-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function TicketsPage() {
  const me = useMe();
  const office = hasRole(me.data, ...OFFICE_ROLES);
  useCrumbs([
    { label: tr('Tickets'), to: '/tickets' },
    { label: office ? tr('All tickets') : tr('My tickets') }
  ]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as TicketView | null) ?? 'active';
  const page = Number(params.get('page') ?? '1');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [exporting, setExporting] = useState(false);

  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const region = useRegion();
  // An area chosen on this page (in the URL) wins over the one at the top of the app.
  const areaId = params.get('areaId') ?? (region.areaId || null);
  const query = new URLSearchParams(params);
  query.delete('page');
  if (areaId) query.set('areaId', areaId);
  query.set('view', view);
  query.set('limit', String(PAGE_SIZE));
  query.set('offset', String((page - 1) * PAGE_SIZE));

  const list = useQuery({
    queryKey: ['tickets', query.toString()],
    queryFn: () => api<List>(`/tickets?${query}`),
    refetchInterval: 30_000
  });
  const counts = useQuery({
    queryKey: ['ticket-counts', areaId],
    queryFn: () => api<TicketCounts>(`/tickets/counts${areaId ? `?areaId=${areaId}` : ''}`),
    enabled: office
  });
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: office
  });
  const total = list.data?.total ?? 0;
  const teams = (lookups.data?.teams ?? []).filter((t) => !areaId || t.areaId === areaId);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{office ? tr('All tickets') : tr('My tickets')}</h1>
          <div className="subtitle">
            {counts.data
              ? tr(
                  me.data?.teamName
                    ? counts.data.active === 1
                      ? '{0} active ticket in team {1}'
                      : '{0} active tickets in team {1}'
                    : counts.data.active === 1
                      ? '{0} active ticket in {1}'
                      : '{0} active tickets in {1}',
                  { 0: counts.data.active, 1: me.data?.teamName ?? region.name }
                )
              : tr('Tickets you are working on')}
          </div>
        </div>
        {office && (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-lg"
              disabled={exporting || total === 0}
              onClick={() => {
                setExporting(true);
                void exportCsv(query).finally(() => setExporting(false));
              }}
            >
              <Download size={18} /> {exporting ? tr('Preparing…') : tr('Export to Excel')}
            </button>
            {creatableTypes(me.data).length > 0 && (
              <Link to="/tickets/new" className="btn btn-primary btn-lg">
                <Plus size={18} /> {tr('New ticket')}
              </Link>
            )}
          </div>
        )}
      </div>

      <section className="card" aria-label={tr('Tickets')}>
        <div className="tabs" role="tablist" aria-label={tr('Ticket views')}>
          {TABS.filter((t) => office || ['active', 'closed', 'all'].includes(t.view)).map((t) => (
            <button
              key={t.view}
              type="button"
              role="tab"
              aria-selected={t.view === view}
              onClick={() => update({ view: t.view === 'active' ? null : t.view })}
            >
              {tr(t.label)}
              {t.count && counts.data && <span className="pill-count">{counts.data[t.count]}</span>}
            </button>
          ))}
        </div>
        {office && (
          <div className="filters">
            <form
              className="search-field"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                update({ q: search.trim() || null });
              }}
            >
              <Search size={18} />
              <input
                type="search"
                aria-label={tr('Search')}
                placeholder={tr('Code, customer, contract, phone, address')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() =>
                  search.trim() !== (params.get('q') ?? '') && update({ q: search.trim() || null })
                }
              />
            </form>
            <select
              aria-label={tr('Type')}
              value={params.get('type') ?? ''}
              onChange={(e) => update({ type: e.target.value })}
            >
              <option value="">{tr('All types')}</option>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <select
              aria-label={tr('Source')}
              value={params.get('source') ?? ''}
              onChange={(e) => update({ source: e.target.value })}
            >
              <option value="">{tr('All sources')}</option>
              {TICKET_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              aria-label={tr('Area')}
              value={areaId ?? ''}
              onChange={(e) => update({ areaId: e.target.value, teamId: null })}
            >
              <option value="">{tr('All areas')}</option>
              {lookups.data?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              aria-label={tr('Team')}
              value={params.get('teamId') ?? ''}
              onChange={(e) => update({ teamId: e.target.value })}
            >
              <option value="">{tr('All teams')}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {list.error && (
          <div className="error" style={{ margin: 20 }}>
            {(list.error as Error).message}
          </div>
        )}
        {list.isLoading && <div className="empty">{tr('Loading…')}</div>}
        {list.data && list.data.items.length === 0 && (
          <div className="empty">
            {params.get('q') ? tr('No ticket matches your search.') : tr('No tickets here.')}
          </div>
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('Ticket')}</th>
                    <th>{tr('From')}</th>
                    <th>{tr('Area')}</th>
                    <th>{tr('Assigned to')}</th>
                    <th>{tr('Status')}</th>
                    <th className="right">{tr('Time left')}</th>
                    <th aria-label={tr('Actions')} />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((t) => {
                    const cell = timeCell(t);
                    return (
                      <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}>
                        <td className="wrap">
                          <Link
                            className="ticket-title"
                            to={`/tickets/${t.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ticketTitle(t.title)}
                          </Link>
                          <div className="meta">
                            {t.code} · {TYPE_LABEL[t.type]}
                            {t.customerName ? ` · ${t.customerName}` : ''}
                          </div>
                        </td>
                        <td>{SOURCE_LABEL[t.source]}</td>
                        <td>{t.areaName ?? <span className="meta">{tr('No area')}</span>}</td>
                        <td>
                          <AssigneeCell ticket={t} />
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                        <td className={['right', cell.className].filter(Boolean).join(' ')}>{cell.text}</td>
                        <td className="right">
                          <button type="button" className="btn btn-sm">
                            {tr('View')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="meta" style={{ fontSize: 14 }}>
                {tr('Showing')} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {tr('of')}{' '}
                {total}
              </span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                >
                  {tr('Previous')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  {tr('Next')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
