import { X } from 'lucide-react';
import { create } from 'zustand';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-200/70 disabled:text-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/40',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/40',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
}

export function Button({ variant = 'primary', size = 'md', busy = false, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className ?? 'h-5 w-5')}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', className)}>{children}</section>;
}

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'orange';

const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
  orange: 'bg-brand-100 text-brand-700',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', TONE[tone], className)}>
      {children}
    </span>
  );
}

const FIELD = 'rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-100';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Ancho completo salvo que quien lo usa pida otro (`w-24`): dos anchos juntos compiten en el CSS. */
function width(className?: string): string | false {
  return !/(^|\s)w-/.test(className ?? '') && 'w-full';
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, width(className), 'h-10', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, width(className), 'py-2', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(FIELD, width(className), 'h-10', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-emerald-600' : 'bg-slate-300',
      )}
    >
      <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">{children}</p>;
}

// ── Avisos breves ────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  tone: 'ok' | 'error';
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast['tone'], text: string) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, text) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, tone, text }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })), tone === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  ok: (text: string) => useToasts.getState().push('ok', text),
  error: (text: string) => useToasts.getState().push('error', text),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 print:hidden" aria-live="polite">
      {toasts.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dismiss(item.id)}
          className={cx(
            'pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-left text-sm font-medium text-white shadow-lg',
            item.tone === 'error' ? 'bg-red-700' : 'bg-slate-900',
          )}
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}

export { cx };
