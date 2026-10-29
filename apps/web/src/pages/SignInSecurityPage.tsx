import type { SignInSettings } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { useCrumbs } from '../components/ui';
import { t } from '../i18n';

/** Each setting with its allowed range (the API checks the same). */
const FIELDS: { key: keyof SignInSettings; label: string; hint: string; min: number; max: number }[] = [
  {
    key: 'minPasswordLength',
    label: 'Shortest password (characters)',
    hint: 'Passwords people choose; they must also have letters and digits.',
    min: 8,
    max: 64
  },
  {
    key: 'maxFailedSignIns',
    label: 'Wrong passwords before the account is locked',
    hint: 'In a row; a correct password starts the count again.',
    min: 3,
    max: 20
  },
  {
    key: 'lockMinutes',
    label: 'Locked for (minutes)',
    hint: 'An administrator can unlock sooner by giving a new temporary password.',
    min: 1,
    max: 1440
  },
  {
    key: 'webSessionDays',
    label: 'Web: stay signed in for (days)',
    hint: 'Counted from the last use; after that the person signs in again.',
    min: 1,
    max: 90
  },
  {
    key: 'appSessionDays',
    label: 'EDM Field app: stay signed in for (days)',
    hint: 'Long enough for staff who are often without signal.',
    min: 1,
    max: 365
  }
];

/** Settings → Sign-in security. */
export function SignInSecurityPage() {
  useCrumbs([{ label: t('Settings') }, { label: t('Sign-in security') }]);
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ['sign-in-settings'],
    queryFn: () => api<SignInSettings>('/admin/settings/sign-in')
  });
  const [form, setForm] = useState<Record<keyof SignInSettings, string> | null>(null);
  useEffect(() => {
    if (current.data && !form) {
      setForm(
        Object.fromEntries(Object.entries(current.data).map(([k, v]) => [k, String(v)])) as Record<
          keyof SignInSettings,
          string
        >
      );
    }
  }, [current.data, form]);

  const save = useMutation({
    mutationFn: () =>
      api<SignInSettings>('/admin/settings/sign-in', {
        method: 'PUT',
        body: Object.fromEntries(Object.entries(form!).map(([k, v]) => [k, Number(v)]))
      }),
    onSuccess: (saved) => queryClient.setQueryData(['sign-in-settings'], saved)
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('Sign-in security')}</h1>
          <div className="subtitle">{t('Rules for passwords and for how long people stay signed in.')}</div>
        </div>
      </div>
      {current.error && <div className="error">{(current.error as Error).message}</div>}
      {form && (
        <form className="card card-pad" style={{ gap: 18, maxWidth: 720 }} onSubmit={submit}>
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`s-${f.key}`}>{t(f.label)}</label>
              <input
                id={`s-${f.key}`}
                type="number"
                required
                min={f.min}
                max={f.max}
                value={form[f.key]}
                style={{ maxWidth: 160 }}
                onChange={(e) => {
                  save.reset();
                  setForm({ ...form, [f.key]: e.target.value });
                }}
              />
              <span className="meta">
                {t(f.hint)} {t('From {0} to {1}.', { 0: f.min, 1: f.max })}
              </span>
            </div>
          ))}
          {save.error && <div className="error">{(save.error as ApiRequestError).message}</div>}
          {save.isSuccess && (
            <div className="notice" role="status" style={{ margin: 0 }}>
              {t('Saved. New sign-ins follow these rules.')}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? t('Saving…') : t('Save changes')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
