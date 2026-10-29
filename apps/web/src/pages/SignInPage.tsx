import { useState, type FormEvent, type ReactNode } from 'react';
import { AuthError, changePassword, signIn, signOut } from '../auth';
import { LANGUAGES, setLanguage, t, useLanguage, type Language } from '../i18n';

/** Two columns like the approved mockup (W01): EDM and what the system does on the left, the form on the right. */
function Frame({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const language = useLanguage();
  return (
    <main className="signin-page">
      <section className="signin-brand">
        <img className="signin-logo" src="/edm-logo.png" alt="Electricidade de Moçambique, E.P." />
        <h2>{t('Technical task management')}</h2>
        <p>{t('One place to receive, assign, follow and close every technical job across the network.')}</p>
        <ul>
          <li>{t('Tickets from Call Center, Sales and the network arrive in one list')}</li>
          <li>{t('Field staff get jobs on their phone and by SMS')}</li>
          <li>{t('Customers are kept informed at every step')}</li>
        </ul>
      </section>
      <section className="signin-panel">
        <div className="signin-card">
          <h1>{title}</h1>
          <p className="signin-intro">{intro}</p>
          {children}
          <footer className="signin-footer">
            <span>{t('Field staff: use the EDM Field app')}</span>
            <label className="signin-language">
              <span>{t('Language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                {(Object.keys(LANGUAGES) as Language[]).map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGES[l]}
                  </option>
                ))}
              </select>
            </label>
          </footer>
        </div>
      </section>
    </main>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  invalid
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="signin-group">
      <label htmlFor={id}>{label}</label>
      <div className="signin-input-group">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="signin-show" aria-controls={id} onClick={() => setShown(!shown)}>
          {shown ? t('Hide') : t('Show')}
        </button>
      </div>
    </div>
  );
}

/** The API's refusal in the person's words. */
function message(err: unknown): string {
  if (!(err instanceof AuthError)) return t('Cannot reach the server. Please try again later.');
  const {
    code,
    details,
    message: text
  } = err.error as {
    code: string;
    details?: { minutes?: number; reason?: string; minLength?: number };
    message: string;
  };
  if (code === 'INVALID_CREDENTIALS') return t('Wrong username or password.');
  if (code === 'WEAK_PASSWORD') {
    if (details?.reason === 'too_short')
      return t('The password needs at least {0} characters.', { 0: details.minLength });
    if (details?.reason === 'letters_and_digits') return t('The password needs letters and digits.');
    if (details?.reason === 'contains_username') return t('The password must not contain your username.');
  }
  if (code === 'ACCOUNT_LOCKED' || code === 'TOO_MANY_ATTEMPTS')
    return t('Too many wrong passwords. Try again in {0} min.', { 0: details?.minutes ?? 15 });
  if (code === 'WRONG_PASSWORD') return t('The current password is wrong.');
  if (code === 'PASSWORD_NOT_CHANGED') return t('Choose a password different from the current one.');
  return t(text);
}

export function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <Frame title={t('Sign in')} intro={t('Use the account given to you by your administrator.')}>
      {error && (
        <div className="signin-alert" role="alert">
          {error}
        </div>
      )}
      <form className="signin-form" onSubmit={submit}>
        <div className="signin-group">
          <label htmlFor="username">{t('Username')}</label>
          <input
            id="username"
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            aria-invalid={!!error || undefined}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <PasswordField
          id="password"
          label={t('Password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={!!error}
        />
        <span className="signin-forgot">{t('Forgot password? Ask your administrator.')}</span>
        <button type="submit" className="signin-btn" disabled={busy}>
          {busy ? t('Signing in…') : t('Sign in')}
        </button>
      </form>
    </Frame>
  );
}

/** After a temporary password: the person chooses their own before using anything else. */
export function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setError(t('The two new passwords are not the same.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <Frame
      title={t('Choose your own password')}
      intro={t('You signed in with a temporary password. Choose your own before you continue.')}
    >
      {error && (
        <div className="signin-alert" role="alert">
          {error}
        </div>
      )}
      <form className="signin-form" onSubmit={submit}>
        <PasswordField
          id="current-password"
          label={t('Temporary password')}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label={t('New password')}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <PasswordField
          id="new-password-again"
          label={t('New password again')}
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
        />
        <span className="signin-hint">{t('Use letters and digits, and not your username.')}</span>
        <button type="submit" className="signin-btn" disabled={busy}>
          {busy ? t('Saving…') : t('Save and continue')}
        </button>
        <button type="button" className="signin-link" onClick={signOut}>
          {t('Sign out')}
        </button>
      </form>
    </Frame>
  );
}
