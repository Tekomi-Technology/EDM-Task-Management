import type { AdminUser, CreateUser, Lookups, UserRole } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useCrumbs } from '../components/ui';
import { UserEditor } from '../components/UserEditor';
import { ROLE_LABEL } from '../format';

function UserStatus({ user }: { user: AdminUser }) {
  if (user.status === 'cancelled') return <span className="badge badge-cancelled">Removed</span>;
  if (user.status === 'blocked') return <span className="badge badge-blocked">Blocked</span>;
  if (!user.lastSeenAt) return <span className="badge">Not signed in yet</span>;
  return <span className="badge badge-active">Active</span>;
}

/** Users & roles (admin): create accounts, change roles and teams, block, reset passwords. */
export function UsersPage() {
  useCrumbs([{ label: 'Settings' }, { label: 'Users and roles' }]);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** A temporary password, shown once after creating an account or resetting its password. */
  const [secret, setSecret] = useState<{ fullName: string; password: string } | null>(null);

  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (role) params.set('role', role);
  const users = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => api<AdminUser[]>(`/admin/users?${params}`)
  });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups') });
  const all = useQuery({ queryKey: ['admin-users', ''], queryFn: () => api<AdminUser[]>('/admin/users') });
  const canSignIn = all.data?.filter((u) => u.status === 'active').length;

  const list = users.data ?? [];
  const selected = creating ? undefined : (list.find((u) => u.id === selectedId) ?? list[0]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const save = useMutation({
    mutationFn: async (values: CreateUser) => {
      if (!creating && selected) {
        const { fullName, email, phone, roles, teamId } = values;
        await api<AdminUser>(`/admin/users/${selected.id}`, {
          method: 'PATCH',
          body: { fullName, email, phone, roles, teamId }
        });
        return null;
      }
      return api<{ user: AdminUser; temporaryPassword: string }>('/admin/users', {
        method: 'POST',
        body: values
      });
    },
    onSuccess: (created) => {
      if (created) {
        setSecret({ fullName: created.user.fullName, password: created.temporaryPassword });
        setCreating(false);
        setSelectedId(created.user.id);
      }
      void refresh();
    }
  });

  const account = useMutation({
    mutationFn: async (v: { user: AdminUser; action: 'block' | 'unblock' | 'cancel' | 'reset-password' }) => {
      const result = await api<AdminUser | { temporaryPassword: string }>(
        `/admin/users/${v.user.id}/${v.action}`,
        {
          method: 'POST'
        }
      );
      return { ...v, result };
    },
    onSuccess: ({ user, result }) => {
      if ('temporaryPassword' in result)
        setSecret({ fullName: user.fullName, password: result.temporaryPassword });
      void refresh();
    }
  });

  const confirmThen = (message: string, run: () => void) => {
    if (window.confirm(message)) run();
  };
  const error = (save.error ?? account.error) as ApiRequestError | null;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Users and roles</h1>
          <div className="subtitle">
            {canSignIn !== undefined ? `${canSignIn} people can sign in. ` : ''}Each role only sees what it
            needs.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => {
            save.reset();
            setCreating(true);
          }}
        >
          <Plus size={18} /> Add user
        </button>
      </div>

      {secret && (
        <div className="notice" role="status">
          <div>
            Temporary password for <strong>{secret.fullName}</strong>:{' '}
            <span className="secret">{secret.password}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            Give it to the person directly. They choose a new password at first sign-in. It is not shown
            again.
          </div>
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setSecret(null)}
          >
            Done
          </button>
        </div>
      )}
      {error && <div className="error">{error.message}</div>}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 420px)' }}>
        <section className="card" aria-label="Accounts">
          <div className="filters">
            <div className="search-field">
              <Search size={18} />
              <input
                type="search"
                aria-label="Search"
                placeholder="Name, username or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as UserRole | '')}>
              <option value="">All roles</option>
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {users.isLoading && <div className="empty">Loading…</div>}
          {users.data && list.length === 0 && <div className="empty">Nobody matches.</div>}
          {list.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Area</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <tr
                      key={u.id}
                      className={['clickable', selected?.id === u.id ? 'selected' : ''].join(' ')}
                      onClick={() => {
                        save.reset();
                        setCreating(false);
                        setSelectedId(u.id);
                      }}
                    >
                      <td className="wrap">
                        <strong style={{ fontSize: 15 }}>{u.fullName}</strong>
                        <div className="meta">{u.username}</div>
                      </td>
                      <td className="wrap" style={{ minWidth: 120 }}>
                        {u.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}
                      </td>
                      <td>
                        {u.areaName ? `${u.areaName}${u.teamName ? ` · ${u.teamName}` : ''}` : 'All areas'}
                      </td>
                      <td>
                        <UserStatus user={u} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {lookups.data && (creating || selected) && (
          <div>
            {selected?.status === 'cancelled' && !creating ? (
              <section className="card card-pad">
                <h2>{selected.fullName}</h2>
                <span className="meta" style={{ fontSize: 14 }}>
                  This account was removed. It is kept so the ticket history still shows the name.
                </span>
              </section>
            ) : (
              <UserEditor
                key={creating ? 'new' : selected!.id}
                lookups={lookups.data}
                user={creating ? undefined : selected}
                busy={save.isPending}
                onSubmit={(values) => save.mutate(values)}
                actions={
                  !creating &&
                  selected && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={account.isPending}
                        onClick={() =>
                          confirmThen(`Give ${selected.fullName} a new temporary password?`, () =>
                            account.mutate({ user: selected, action: 'reset-password' })
                          )
                        }
                      >
                        Reset password
                      </button>
                      {selected.status === 'active' ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={account.isPending}
                          onClick={() =>
                            confirmThen(`Block ${selected.fullName}? They are signed out at once.`, () =>
                              account.mutate({ user: selected, action: 'block' })
                            )
                          }
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          disabled={account.isPending}
                          onClick={() => account.mutate({ user: selected, action: 'unblock' })}
                        >
                          Unblock
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={account.isPending}
                        onClick={() =>
                          confirmThen(
                            `Remove ${selected.fullName} for good? Their name stays in ticket history.`,
                            () => account.mutate({ user: selected, action: 'cancel' })
                          )
                        }
                      >
                        Remove user
                      </button>
                    </>
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
