import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** Shown in red after a divider, for deleting. */
  danger?: boolean;
}

/** A "⋯" button that opens a short list of actions; closes on a click elsewhere or Escape. */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const plain = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  return (
    <div className="action-menu" ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {plain.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
          {danger.length > 0 && plain.length > 0 && <div className="menu-divider" />}
          {danger.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
