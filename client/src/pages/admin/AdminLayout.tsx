import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/app';
import ThemeToggle from '../../components/ThemeToggle';

const LINKS = [
  ['/admin', 'Dashboard', true], ['/admin/products', 'Products'], ['/admin/categories', 'Categories'], ['/admin/orders', 'Orders'],
  ['/admin/customers', 'Customers'], ['/admin/coupons', 'Coupons'], ['/admin/reviews', 'Reviews'], ['/admin/audit', 'Audit log'],
] as const;

export default function AdminLayout() {
  const { user, logout } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${open ? 'block' : 'hidden'} w-full shrink-0 bg-ink-900 text-ink-300 lg:block lg:w-60`}>
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-bold text-white"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600">S</span>Shop Admin</div>
        <nav className="space-y-1 px-3 pb-6" onClick={() => setOpen(false)}>
          {LINKS.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end as boolean | undefined} className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-ink-800 font-medium text-white' : 'hover:bg-ink-800/60'}`}>{label}</NavLink>
          ))}
          <Link to="/" className="mt-4 block rounded-lg px-3 py-2 text-sm text-ink-400 hover:bg-ink-800/60">← View storefront</Link>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button className="btn-outline btn-sm lg:hidden" onClick={() => setOpen((o) => !o)}>☰ Menu</button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ThemeToggle />
            <span className="hidden text-slate-500 sm:inline">{user?.email}</span>
            <button className="btn-outline btn-sm" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
          </div>
        </header>
        <main className="p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
