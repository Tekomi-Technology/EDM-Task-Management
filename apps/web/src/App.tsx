import type { TicketCounts } from '@edm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Cable,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  LogOut,
  HelpCircle,
  Home as HomeIcon,
  MapPin,
  Package,
  Phone,
  Search,
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
import { Avatar, CrumbContext, hasRole, OFFICE_ROLES, useMe, type Crumb } from './components/ui';
import { ROLE_LABEL } from './format';
import { AssignPage } from './pages/AssignPage';
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
import { ConnectedSystemsPage } from './pages/ConnectedSystemsPage';

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
        aria-label="Search tickets"
        placeholder="Search tickets, customers, phone…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <kbd>/</kbd>
    </form>
  );
}

function UserMenu() {
  const me = useMe();
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
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
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
        <nav className="nav" aria-label="Main">
          <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
            <img src="/edm-emblem.png" alt="EDM logo" />
            <div>
              <strong>EDM Tasks</strong>
              <small>Electricidade de Moçambique</small>
            </div>
          </Link>
          {office && <NavItem to="/" icon={<LayoutGrid size={20} />} label="Overview" />}
          <div className="nav-group">Tickets</div>
          <NavItem
            to="/tickets"
            icon={<Ticket size={20} />}
            label={office ? 'All tickets' : 'My tickets'}
            count={counts.data?.active}
          />
          {office && (
            <NavItem
              to="/checks"
              icon={<Phone size={20} />}
              label="Closing checks"
              count={counts.data?.waiting_check}
            />
          )}
          {office && (
            <>
              <NavItem
                to="/incidents"
                icon={<Zap size={20} />}
                label="Network incidents"
                count={counts.data?.incidents}
              />
              <NavItem to="/planned" icon={<CalendarDays size={20} />} label="Planned work" />
              <NavItem to="/new-customers" icon={<HomeIcon size={20} />} label="New customers" />
              <div className="nav-group">Field</div>
              <NavItem to="/live" icon={<MapPin size={20} />} label="Live map" />
              <NavItem to="/staff" icon={<Users size={20} />} label="Field staff" />
              <NavItem
                to="/help"
                icon={<HelpCircle size={20} />}
                label="Help requests"
                count={counts.data?.help}
              />
              <NavItem to="/stock" icon={<Package size={20} />} label="Stock" />
            </>
          )}
          {hasRole(me.data, 'admin', 'technical_manager', 'team_manager', 'noc') && (
            <>
              <div className="nav-group">Insights</div>
              <NavItem to="/reports" icon={<BarChart3 size={20} />} label="Reports" />
            </>
          )}
          {hasRole(me.data, 'admin', 'technical_manager') && (
            <>
              <div className="nav-group">Settings</div>
              {hasRole(me.data, 'admin') && (
                <NavItem to="/users" icon={<UserCog size={20} />} label="Users & roles" />
              )}
              <NavItem to="/systems" icon={<Cable size={20} />} label="Connected systems" />
            </>
          )}
          <div className="version">EDM Tasks · version 1.0</div>
        </nav>
        <div className="main">
          <header className="topbar">
            <div className="crumbs" aria-label="You are here">
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
        <Route path="/tickets/:id/assign" element={<AssignPage />} />
        <Route path="/checks" element={<ClosingChecksPage />} />
        <Route path="/incidents" element={<NetworkIncidentsPage />} />
        <Route path="/planned" element={<PlannedWorkPage />} />
        <Route path="/live" element={<LiveMapPage />} />
        <Route path="/staff" element={<FieldStaffPage />} />
        <Route path="/new-customers" element={<NewCustomersPage />} />
        <Route path="/help" element={<HelpRequestsPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/systems" element={<ConnectedSystemsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
