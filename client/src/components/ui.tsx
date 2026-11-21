import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/app';
import { STATUS_STYLE, statusLabel } from '../lib/format';

export function Stars({ value, size = 16, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)));
        const star = (
          <svg width={size} height={size} viewBox="0 0 24 24" className="block">
            <defs>
              <linearGradient id={`g${n}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
                <stop offset={`${fill * 100}%`} style={{ stopColor: 'rgb(var(--slate-300))' }} />
              </linearGradient>
            </defs>
            <path fill={`url(#g${n}-${Math.round(fill * 100)})`} d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
          </svg>
        );
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star`} className="p-0.5">
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
    </span>
  );
}

/** <img> that shows a neutral placeholder when there is no image or it fails to load (e.g. deleted from storage). */
export function Img({ src, alt = '', className = '', ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setBad(false);
  }, [src]);
  if (!src || bad) {
    return (
      <div role="img" aria-label={alt || 'No image'} className={`grid place-items-center bg-slate-100 text-slate-300 ${className}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-1/3 w-1/3 max-h-12 max-w-12">
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBad(true)} {...rest} />;
}

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-700'}`}>{statusLabel(status)}</span>
);

export const Spinner = () => (
  <div className="flex justify-center py-16" role="progressbar" aria-label="Loading">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
  </div>
);

export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="card flex flex-col items-center px-6 py-16 text-center">
    <div className="mb-3 text-4xl">🛍️</div>
    <h3 className="text-lg font-semibold">{title}</h3>
    {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorBox = ({ msg }: { msg: string }) =>
  msg ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div> : null;

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
      <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
          <button onClick={() => onChange(n)} aria-current={n === page} className={`btn-sm btn ${n === page ? 'bg-slate-900 text-slate-50' : 'border border-slate-300 bg-white'}`}>{n}</button>
        </span>
      ))}
      <button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>
  );
}

export function RequireAuth({ admin, children }: { admin?: boolean; children: ReactNode }) {
  const { user, loading } = useApp();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError('')))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1), setData };
}

export const BackLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-sm text-slate-500 hover:text-slate-900">← {children}</Link>
);
