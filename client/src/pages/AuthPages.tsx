import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';

/** Only allow same-site relative redirects (prevents open-redirect). */
const safePath = (p: unknown) => (typeof p === 'string' && /^\/(?!\/|\\)/.test(p) ? p : '/');

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { user, setUser } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const from = safePath((loc.state as any)?.from);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.role === 'ADMIN' && from === '/' ? '/admin' : from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post('/api/auth/login', { email, password });
      setUser(r.user);
      nav(r.user.role === 'ADMIN' && from === '/' ? '/admin' : from, { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Welcome back" sub="Sign in to your account">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link></div>
        <ErrorBox msg={err} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">New here? <Link to="/signup" state={loc.state} className="font-medium text-brand-600 hover:underline">Create an account</Link></p>
    </Shell>
  );
}

export function Signup() {
  const { user, setUser } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const from = safePath((loc.state as any)?.from);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const checks = [
    [f.password.length >= 8, '8+ characters'], [/[a-z]/.test(f.password), 'lowercase'], [/[A-Z]/.test(f.password), 'uppercase'], [/\d/.test(f.password), 'number'],
  ] as const;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post('/api/auth/signup', f);
      setUser(r.user);
      nav(from, { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Create your account" sub="Join to track orders, save a wishlist and check out faster">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="name">Full name</label><input id="name" className="input" autoComplete="name" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" required maxLength={72} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {checks.map(([ok, l]) => <li key={l} className={ok ? 'text-emerald-600' : 'text-slate-400'}>{ok ? '✓' : '○'} {l}</li>)}
          </ul>
        </div>
        <ErrorBox msg={err} />
        <button className="btn-primary w-full" disabled={busy || checks.some(([ok]) => !ok)}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to="/login" state={loc.state} className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api.post('/api/auth/forgot-password', { email }).catch(() => undefined);
    setSent(true); setBusy(false);
  };
  return (
    <Shell title="Reset your password" sub="We'll email you a link to set a new password">
      {sent ? <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 1 hour.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={busy}>Send reset link</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link></p>
    </Shell>
  );
}

export function Reset() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { toast } = useApp();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/auth/reset-password', { token: sp.get('token') ?? '', password });
      toast('Password updated. Please sign in.');
      nav('/login');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} /><p className="mt-1 text-xs text-slate-400">8+ characters with upper, lower case and a number.</p></div>
        <ErrorBox msg={err} />
        <button className="btn-primary w-full">Update password</button>
      </form>
    </Shell>
  );
}
