import { Check, Copy, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export interface TemporaryPassword {
  fullName: string;
  username: string;
  roles: string[];
  password: string;
}

/** "Tq8Nb2Ws7Kzx" as "Tq8N b2Ws 7Kzx", easier to read out and copy by hand. */
function grouped(password: string): string {
  return password.match(/.{1,4}/g)?.join(' ') ?? password;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : label}
    </button>
  );
}

/**
 * A new or reset temporary password, shown once in the middle of the screen. It closes only after the
 * administrator confirms they wrote it down or passed it on, so it cannot be dismissed by accident.
 */
export function TemporaryPasswordDialog({
  secret,
  onClose
}: {
  secret: TemporaryPassword;
  onClose: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const [kept, setKept] = useState(false);
  useEffect(() => {
    const dialog = box.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);
  const fieldStaff = secret.roles.includes('field_staff');
  return (
    <dialog
      ref={box}
      className="secret-dialog"
      aria-labelledby="secret-title"
      // Escape must not throw the password away before it is kept.
      onCancel={(e) => {
        if (!kept) e.preventDefault();
      }}
      onClose={onClose}
    >
      <span className="secret-icon" aria-hidden="true">
        <KeyRound size={26} />
      </span>
      <div className="secret-head">
        <h2 id="secret-title">{t('Temporary password of {0}', { 0: secret.fullName })}</h2>
        <span className="meta">
          {t('Username')}: <strong className="mono">{secret.username}</strong>{' '}
          <CopyButton text={secret.username} label={t('Copy')} />
        </span>
      </div>
      <div className="secret-box">
        <span className="secret-value">{grouped(secret.password)}</span>
        <CopyButton text={secret.password} label={t('Copy the password')} />
      </div>
      <p>
        {fieldStaff
          ? t(
              'Give it to the person directly. They sign in on the EDM Field app and choose a new password the first time.'
            )
          : t(
              'Give it to the person directly. They sign in at {0} and choose a new password the first time.',
              {
                0: window.location.host
              }
            )}{' '}
        <strong>{t('Once closed it cannot be seen again.')}</strong>
      </p>
      <label className="secret-confirm">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
        {t('I have written down or passed on this password')}
      </label>
      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={!kept}
        onClick={() => {
          // Closing the dialog fires its close event, which calls onClose.
          if (typeof box.current?.close === 'function') box.current.close();
          else onClose();
        }}
      >
        {t('Close')}
      </button>
    </dialog>
  );
}
