import type { Inbox, Lookups } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, HelpCircle, MapPin } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { ago, STATUS_LABEL } from '../format';
import { hasRole, useMe } from './ui';
import { t } from '../i18n';

/** People who see every area and can narrow the screens to one; team managers already see their own team. */
const SEES_ALL_AREAS = ['admin', 'technical_manager', 'noc', 'bo_support', 'network_team'];
const REGION_KEY = 'edm.region';

interface Region {
  /** '' for all areas. */
  areaId: string;
  setAreaId: (id: string) => void;
}
const RegionContext = createContext<Region>({ areaId: '', setAreaId: () => undefined });

export function RegionProvider({ children }: { children: ReactNode }) {
  const [areaId, setArea] = useState(() => {
    try {
      return localStorage.getItem(REGION_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const setAreaId = (id: string) => {
    setArea(id);
    try {
      localStorage.setItem(REGION_KEY, id);
    } catch {
      // The choice then lasts until the page is reloaded.
    }
  };
  return <RegionContext.Provider value={{ areaId, setAreaId }}>{children}</RegionContext.Provider>;
}

/**
 * The area chosen at the top of the page ('' for all), its name for headings ("Maputo region" for all of them),
 * and a helper adding it to an API path.
 */
export function useRegion() {
  const { areaId } = useContext(RegionContext);
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: !!areaId
  });
  const name = (areaId && lookups.data?.areas.find((a) => a.id === areaId)?.name) || t('Maputo region');
  const withArea = (path: string) =>
    areaId ? `${path}${path.includes('?') ? '&' : '?'}areaId=${areaId}` : path;
  return { areaId, name, withArea };
}

/** "📍 Maputo ▾": narrows lists, maps and figures to one area. */
export function RegionPicker() {
  const me = useMe();
  const { areaId, setAreaId } = useContext(RegionContext);
  const seesAll = hasRole(me.data, ...SEES_ALL_AREAS);
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: seesAll
  });
  const areas = lookups.data?.areas ?? [];
  // A remembered area that no longer exists (or a person who lost the right) falls back to all areas.
  useEffect(() => {
    if (areaId && lookups.data && !areas.some((a) => a.id === areaId)) setAreaId('');
  }, [areaId, areas, lookups.data, setAreaId]);
  if (!seesAll) return null;
  return (
    <label className="region-picker">
      <MapPin size={18} aria-hidden />
      <span className="sr-only">{t('Area')}</span>
      <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
        <option value="">{t('All areas')}</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden />
    </label>
  );
}

/** Closes a pop-up menu when clicking elsewhere or pressing Escape. */
function usePopup() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, box };
}

/** The bell: office alerts (also sent by SMS) with the number not read yet. */
export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { open, setOpen, box } = usePopup();
  const inbox = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api<Inbox>('/me/notifications'),
    refetchInterval: 30_000
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) => api<null>('/me/notifications/read', { method: 'POST', body: { ids } }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['inbox'] })
  });
  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];
  return (
    <div className="user-menu" ref={box}>
      <button
        type="button"
        className="icon-button"
        aria-label={unread ? t('Notifications, {0} not read', { 0: unread }) : t('Notifications')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) void inbox.refetch();
          setOpen((o) => !o);
        }}
      >
        <Bell size={22} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu inbox" role="menu" aria-label={t('Notifications')}>
          <div className="inbox-head">
            <strong>{t('Notifications')}</strong>
            {unread > 0 && (
              <button type="button" className="link-button" onClick={() => read.mutate(undefined)}>
                {t('Mark all as read')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="meta" style={{ padding: '12px 10px' }}>
              {t(
                'Nothing yet. New tickets waiting for someone, late tickets and help requests show up here.'
              )}
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                role="menuitem"
                className={n.read ? 'inbox-item' : 'inbox-item unread'}
                onClick={() => {
                  if (!n.read) read.mutate([n.id]);
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="dot" aria-hidden />
                <span style={{ flex: 1 }}>
                  {n.title}
                  <span className="meta" style={{ display: 'block', fontSize: 13 }}>
                    {ago(n.createdAt)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The "?" button: shortcuts and what the ticket states mean. */
export function HelpButton() {
  const me = useMe();
  const { open, setOpen, box } = usePopup();
  return (
    <div className="user-menu" ref={box}>
      <button
        type="button"
        className="icon-button"
        aria-label={t('Help')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <HelpCircle size={22} />
      </button>
      {open && (
        <div className="menu help-panel" role="dialog" aria-label={t('Help')}>
          <strong>{t('Quick help')}</strong>
          <dl>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>{t('Search tickets by code, customer name, contract or phone.')}</dd>
            {hasRole(me.data, ...SEES_ALL_AREAS) && (
              <>
                <dt>
                  <MapPin size={14} aria-hidden />
                </dt>
                <dd>{t('The area next to the search narrows lists, maps and reports to that area.')}</dd>
              </>
            )}
          </dl>
          <strong>{t('What the ticket states mean')}</strong>
          <dl>
            {(
              [
                ['new', t('Offered to the team; nobody has claimed it yet.')],
                ['assigned', t('Sent to a staff member, who has not accepted yet.')],
                ['accepted', t('The staff member is on the way.')],
                ['in_progress', t('Being fixed on site.')],
                ['on_hold', t('Work stopped for a reason given by the staff member.')],
                ['resolved', t('Reported fixed; the Call Center or NOC checks with the customer.')],
                ['reopened', t('The check found it not fixed; it is offered to the team again.')],
                ['closed', t('Checked and finished.')]
              ] as const
            ).map(([status, text]) => (
              <div key={status} style={{ display: 'contents' }}>
                <dt>{STATUS_LABEL[status]}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <div className="meta">
            {t('For an account or access problem, ask your EDM Tasks administrator.')}
          </div>
        </div>
      )}
    </div>
  );
}
