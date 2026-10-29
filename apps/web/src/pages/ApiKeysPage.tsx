import { API_KEY_SYSTEMS, type ApiKeySystem, type ApiKeyView, type CreatedApiKey } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { useCrumbs } from '../components/ui';
import { ago, formatWhen } from '../format';
import { t, translated } from '../i18n';

const SYSTEM_NAME = translated<ApiKeySystem>({
  call_center: 'Call Center',
  sales: 'Sales system',
  nms: 'Network management (NMS)',
  stock: 'Stock management'
});

function NewKey({ created, onDone }: { created: CreatedApiKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        {t('New key for')} <strong>{SYSTEM_NAME[created.apiKey.system]}</strong> · {created.apiKey.name}
      </div>
      <code className="secret" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
        {created.key}
      </code>
      <div>{t('Copy it now and give it to the team running that system. It is not shown again.')}</div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void navigator.clipboard.writeText(created.key).then(() => setCopied(true))}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy')}
        </button>
        <button type="button" className="btn btn-sm" onClick={onDone}>
          {t('Done')}
        </button>
      </div>
    </div>
  );
}

/** Settings → API keys: the keys the Call Center, Sales, NMS and stock systems call EDM Tasks with. */
export function ApiKeysPage() {
  useCrumbs([{ label: t('Settings') }, { label: t('API keys') }]);
  const queryClient = useQueryClient();
  const [system, setSystem] = useState<ApiKeySystem>('call_center');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api<ApiKeyView[]>('/admin/api-keys') });

  const create = useMutation({
    mutationFn: () =>
      api<CreatedApiKey>('/admin/api-keys', { method: 'POST', body: { system, name: name.trim() } }),
    onSuccess: (made) => {
      setCreated(made);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    }
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<ApiKeyView>(`/admin/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const error = (create.error ?? revoke.error ?? keys.error) as ApiRequestError | Error | null;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('API keys')}</h1>
          <div className="subtitle">
            {t('The other EDM systems call EDM Tasks with these keys.')}{' '}
            <Link to="/api-docs">{t('What each system can call')}</Link>
          </div>
        </div>
      </div>

      {created && <NewKey created={created} onDone={() => setCreated(null)} />}
      {error && <div className="error">{error.message}</div>}

      <form className="card card-pad" style={{ gap: 14 }} onSubmit={submit} aria-label={t('New key')}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('New key')}</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="key-system">{t('System')}</label>
            <select
              id="key-system"
              value={system}
              onChange={(e) => setSystem(e.target.value as ApiKeySystem)}
            >
              {API_KEY_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {SYSTEM_NAME[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="key-name">{t('Name, to recognise it')}</label>
            <input
              id="key-name"
              required
              minLength={2}
              maxLength={100}
              value={name}
              placeholder={t('e.g. Call Center production')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <KeyRound size={16} /> {create.isPending ? t('Creating…') : t('Make key')}
          </button>
        </div>
      </form>

      <section className="card" aria-label={t('API keys')}>
        {keys.data?.length === 0 ? (
          <div className="empty">{t('No keys yet.')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('System')}</th>
                  <th>{t('Starts with')}</th>
                  <th>{t('Made')}</th>
                  <th>{t('Last used')}</th>
                  <th>{t('Status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.data?.map((k) => (
                  <tr key={k.id} style={k.revokedAt ? { color: 'var(--muted)' } : undefined}>
                    <td>
                      <strong>{k.name}</strong>
                    </td>
                    <td>{SYSTEM_NAME[k.system]}</td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td className="meta">
                      {formatWhen(k.createdAt)}
                      {k.createdByName ? ` · ${k.createdByName}` : ''}
                    </td>
                    <td className="meta">{k.lastUsedAt ? ago(k.lastUsedAt) : t('Never')}</td>
                    <td>
                      {k.revokedAt ? (
                        <span className="badge badge-cancelled">{t('Revoked')}</span>
                      ) : (
                        <span className="badge badge-active">{t('In use')}</span>
                      )}
                    </td>
                    <td className="right">
                      {!k.revokedAt && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={revoke.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                t('Revoke the key "{0}"? The system can no longer call with it.', {
                                  0: k.name
                                })
                              )
                            )
                              revoke.mutate(k.id);
                          }}
                        >
                          {t('Revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
