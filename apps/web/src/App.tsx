import type { TicketCounts } from './types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Languages,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  HelpCircle,
  KeyRound,
  Home as HomeIcon,
  MapPin,
  Package,
  Phone,
  Search,
  ShieldCheck,
  Ticket,
  UserCog,
  Users,
  Zap
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router';
import { api } from './api';
import { signOut } from './auth';
import { HelpButton, NotificationBell, RegionPicker, RegionProvider, useRegion } from './components/topbar';
import { Avatar, Card, CrumbContext, hasRole, OFFICE_ROLES, useMe, type Crumb } from './components/ui';
import { ROLE_LABEL } from './format';
import { ApiDocsPage } from './pages/ApiDocsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AreasPage } from './pages/AreasPage';
import { ClosingChecksPage } from './pages/ClosingChecksPage';
import { FieldStaffPage } from './pages/FieldStaffPage';
import { HelpRequestsPage } from './pages/HelpRequestsPage';
import { LiveMapPage } from './pages/LiveMapPage';
import { NetworkIncidentsPage } from './pages/NetworkIncidentsPage';
import { NewCustomersPage } from './pages/NewCustomersPage';
import { NewTicketPage } from './pages/NewTicketPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlannedWorkPage } from './pages/PlannedWorkPage';
import { StockPage } from './pages/StockPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketsPage } from './pages/TicketsPage';
import { UsersPage } from './pages/UsersPage';
import { ReportsPage } from './pages/ReportsPage';
import { SignInSecurityPage } from './pages/SignInSecurityPage';
import { LANGUAGES, setLanguage, t, useLanguage, type Language } from './i18n';

function NavItem({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count?: number }) {
  return (
    <NavLink to={to} end={to === '/'}>
      {icon}
      {label}
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </NavLink>
  );
}

/** Top-bar search: Enter opens the ticket list filtered by the text; "/" jumps here from anywhere. */
function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) navigate(`/tickets?view=all&q=${encodeURIComponent(text.trim())}`);
      }}
    >
      <Search size={18} />
      <input
        ref={input}
        type="search"
        aria-label={t('Search tickets')}
        placeholder={t('Search tickets, customers, phone…')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <kbd>/</kbd>
    </form>
  );
}

function UserMenu() {
  const me = useMe();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me.data) return null;
  return (
    <div className="user-menu" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={me.data.fullName} />
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="who">
            <strong>{me.data.fullName}</strong>
            <div className="meta">
              {me.data.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}
              {me.data.teamName ? ` · ${me.data.teamName}` : ''}
            </div>
          </div>
          <label className="menu-language">
            <Languages size={16} aria-hidden />
            <span className="sr-only">{t('Language')}</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {(Object.keys(LANGUAGES) as Language[]).map((l) => (
                <option key={l} value={l}>
                  {LANGUAGES[l]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut size={16} /> {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div className="crumbs" aria-label={t('You are here')}>
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <ChevronRight size={16} />}
          {i === crumbs.length - 1 ? (
            <strong>{c.label}</strong>
          ) : c.to ? (
            <Link to={c.to}>{c.label}</Link>
          ) : (
            <span>{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The admin area (/admin), for administrators only: its own menu of the admin pages, apart from the operations
 * pages. Neither links to the other; an administrator opens the address of the part they want.
 */
function AdminShell() {
  const me = useMe();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  if (!me.data) return null;
  if (!hasRole(me.data, 'admin')) {
    return (
      <main className="no-access">
        <Card className="card-pad">
          <h1>{t('Administration')}</h1>
          <p>{t('Only administrators can open this page.')}</p>
          <button type="button" className="btn" onClick={signOut}>
            <LogOut size={16} /> {t('Sign out')}
          </button>
        </Card>
      </main>
    );
  }
  return (
    <CrumbContext.Provider value={setCrumbs}>
      <div className="shell admin">
        <nav className="nav" aria-label={t('Administration')}>
          <Link to="/admin/users" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
            <img src="/edm-emblem.png" alt={t('EDM logo')} />
            <div>
              <strong>{t('EDM Tasks')}</strong>
              <small>{t('Administration')}</small>
            </div>
          </Link>
          <NavItem to="/admin/users" icon={<UserCog size={20} />} label={t('Users & roles')} />
          <NavItem to="/admin/areas" icon={<MapIcon size={20} />} label={t('Areas and teams')} />
          <NavItem to="/admin/api-keys" icon={<KeyRound size={20} />} label={t('API keys')} />
          <NavItem to="/admin/security" icon={<ShieldCheck size={20} />} label={t('Sign-in security')} />
          <NavItem to="/admin/api-docs" icon={<BookOpen size={20} />} label={t('API documentation')} />
          <div className="version">{t('EDM Tasks · version 1.0')}</div>
        </nav>
        <div className="main">
          <header className="topbar">
            <Crumbs crumbs={crumbs} />
            <UserMenu />
          </header>
          <Outlet />
        </div>
      </div>
    </CrumbContext.Provider>
  );
}

function Shell() {
  return (
    <RegionProvider>
      <ShellLayout />
    </RegionProvider>
  );
}

function ShellLayout() {
  const me = useMe();
  const { areaId, withArea } = useRegion();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const office = hasRole(me.data, ...OFFICE_ROLES);
  const counts = useQuery({
    queryKey: ['ticket-counts', areaId],
    queryFn: () => api<TicketCounts>(withArea('/tickets/counts')),
    placeholderData: keepPreviousData,
    enabled: office,
    refetchInterval: 30_000
  });

  return (
    <CrumbContext.Provider value={setCrumbs}>
      <div className="shell">
        <nav className="nav" aria-label={t('Main')}>
          <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
            <img src="/edm-emblem.png" alt={t('EDM logo')} />
            <div>
              <strong>{t('EDM Tasks')}</strong>
              <small>{t('Electricidade de Moçambique')}</small>
            </div>
          </Link>
          {office && <NavItem to="/" icon={<LayoutGrid size={20} />} label={t('Overview')} />}
          <div className="nav-group">{t('Tickets')}</div>
          <NavItem
            to="/tickets"
            icon={<Ticket size={20} />}
            label={office ? t('All tickets') : t('My tickets')}
            count={counts.data?.active}
          />
          {office && (
            <NavItem
              to="/checks"
              icon={<Phone size={20} />}
              label={t('Closing checks')}
              count={counts.data?.waiting_check}
            />
          )}
          {office && (
            <>
              <NavItem
                to="/incidents"
                icon={<Zap size={20} />}
                label={t('Network incidents')}
                count={counts.data?.incidents}
              />
              <NavItem to="/planned" icon={<CalendarDays size={20} />} label={t('Planned work')} />
              <NavItem to="/new-customers" icon={<HomeIcon size={20} />} label={t('New customers')} />
              <div className="nav-group">{t('Field')}</div>
              <NavItem to="/live" icon={<MapPin size={20} />} label={t('Live map')} />
              <NavItem to="/staff" icon={<Users size={20} />} label={t('Field staff')} />
              <NavItem
                to="/help"
                icon={<HelpCircle size={20} />}
                label={t('Help requests')}
                count={counts.data?.help}
              />
              <NavItem to="/stock" icon={<Package size={20} />} label={t('Stock')} />
            </>
          )}
          {hasRole(me.data, 'admin', 'technical_manager', 'team_manager', 'noc') && (
            <>
              <div className="nav-group">{t('Insights')}</div>
              <NavItem to="/reports" icon={<BarChart3 size={20} />} label={t('Reports')} />
            </>
          )}
          <div className="version">{t('EDM Tasks · version 1.0')}</div>
        </nav>
        <div className="main">
          <header className="topbar">
            <Crumbs crumbs={crumbs} />
            {office && <GlobalSearch />}
            {office && <RegionPicker />}
            {office && <NotificationBell />}
            <HelpButton />
            <UserMenu />
          </header>
          <Outlet />
        </div>
      </div>
    </CrumbContext.Provider>
  );
}

/** Office staff start on the Overview; field staff (who mostly use the app) on their tickets. */
function Home() {
  const me = useMe();
  if (!me.data) return null;
  return hasRole(me.data, ...OFFICE_ROLES) ? <OverviewPage /> : <Navigate to="/tickets" replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/checks" element={<ClosingChecksPage />} />
        <Route path="/incidents" element={<NetworkIncidentsPage />} />
        <Route path="/planned" element={<PlannedWorkPage />} />
        <Route path="/live" element={<LiveMapPage />} />
        <Route path="/staff" element={<FieldStaffPage />} />
        <Route path="/new-customers" element={<NewCustomersPage />} />
        <Route path="/help" element={<HelpRequestsPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* Saved links from before the admin area. */}
        {['users', 'api-docs', 'api-keys', 'areas', 'security'].map((page) => (
          <Route key={page} path={`/${page}`} element={<Navigate to={`/admin/${page}`} replace />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="areas" element={<AreasPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="security" element={<SignInSecurityPage />} />
        <Route path="api-docs" element={<ApiDocsPage />} />
        <Route path="*" element={<Navigate to="/admin/users" replace />} />
      </Route>
    </Routes>
  );
}
