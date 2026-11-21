import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { Img, useAsync } from './ui';
import ThemeToggle from './ThemeToggle';

const Icon = ({ d, className = 'h-5 w-5' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={d} /></svg>
);
export const ICONS = {
  cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3c-.6.6-.2 1.7.7 1.7H17M17 17a1 1 0 100 2 1 1 0 000-2zM9 17a1 1 0 100 2 1 1 0 000-2z',
  heart: 'M4.3 6.3a4.5 4.5 0 016.4 0L12 7.6l1.3-1.3a4.5 4.5 0 116.4 6.4L12 20.4l-7.7-7.7a4.5 4.5 0 010-6.4z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  search: 'M21 21l-4.3-4.3M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  close: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevron: 'M6 9l6 6 6-6',
};
export { Icon };

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;

/** Full-width search bar that sweeps in from the search icon and covers the navbar. */
function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sugg, setSugg] = useState<any[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(sp.get('q') ?? '');
    const t = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setSugg([]);
      return;
    }
    const t = setTimeout(() => api.get('/api/products/suggest', { q: q.trim() }).then((r) => setSugg(r.items)).catch(() => setSugg([])), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const outside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-search-root],[data-search-toggle]')) onClose();
    };
    window.addEventListener('keydown', esc);
    document.addEventListener('mousedown', outside);
    return () => {
      window.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', outside);
    };
  }, [open, onClose]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const term = q.trim();
    if (!term) return;
    nav(`/products?q=${encodeURIComponent(term)}`);
    onClose();
  };

  return (
    <div data-search-root className={`absolute inset-0 z-20 ${open ? 'visible' : 'invisible'} transition-[visibility] duration-300`} aria-hidden={!open}>
      {/* The bar itself is revealed with a clip-path wipe that starts at the search icon (right edge). */}
      <form
        role="search"
        onSubmit={submit}
        className="flex h-full items-center gap-3 bg-surface px-4 transition-[clip-path,opacity] duration-300 ease-out"
        style={{ clipPath: open ? 'inset(0 0 0 0)' : 'inset(0 0 0 100%)', opacity: open ? 1 : 0 }}
      >
        <Icon d={ICONS.search} className="h-5 w-5 shrink-0 text-slate-400" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          placeholder="Search for products, brands and more…"
          aria-label="Search products"
          className="h-10 min-w-0 flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
          tabIndex={open ? 0 : -1}
        />
        <button type="submit" className="btn-primary btn-sm hidden sm:inline-flex" tabIndex={open ? 0 : -1} disabled={!q.trim()}>Search</button>
        <button type="button" onClick={onClose} className="btn-ghost !px-2.5" aria-label="Close search" tabIndex={open ? 0 : -1}>
          <Icon d={ICONS.close} />
        </button>
      </form>

      {open && q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full border-b border-slate-200 bg-surface shadow-lg">
          <ul className="mx-auto max-w-3xl py-2">
            <li>
              <button onClick={() => submit()} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-100">
                <Icon d={ICONS.search} className="h-4 w-4 text-slate-400" /> See all results for <b>“{q.trim()}”</b>
              </button>
            </li>
            {sugg.map((s) => (
              <li key={s.id}>
                <Link to={`/products/${s.slug}`} onClick={onClose} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-100">
                  <Img src={s.images[0]} alt="" className="h-10 w-10 rounded object-cover" />
                  <span className="flex-1 truncate text-sm">{s.name}</span>
                  <span className="text-sm font-medium">{money(s.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CategoriesMenu({ cats }: { cats: any[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={`${linkCls({ isActive: open })} inline-flex items-center gap-1`}>
        Categories <Icon d={ICONS.chevron} className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <Link role="menuitem" to="/products" className="block px-4 py-2 text-sm font-medium hover:bg-slate-100">All products</Link>
          {cats.map((c) => (
            <Link role="menuitem" key={c.id} to={`/products?category=${c.slug}`} className="flex items-center justify-between px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              {c.name}<span className="text-xs text-slate-400">{c.productCount}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  const { user, logout, cart, wishlist } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [userMenu, setUserMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [searching, setSearching] = useState(false);
  const { data } = useAsync(() => api.get('/api/categories'), []);
  const cats: any[] = data?.categories ?? [];

  useEffect(() => {
    setMobile(false);
    setUserMenu(false);
  }, [loc.pathname, loc.search]);

  const closeSearch = () => setSearching(false);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="relative mx-auto h-16 max-w-7xl">
        {/* While the search bar is open the rest of the navbar is hidden *and* inert (not focusable / clickable). */}
        <div
          inert={searching}
          aria-hidden={searching}
          className={`flex h-full items-center gap-2 px-4 transition-all duration-300 ${searching ? 'pointer-events-none -translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}
        >
          <button className="btn-ghost !px-2.5 lg:hidden" onClick={() => setMobile((m) => !m)} aria-label="Menu" aria-expanded={mobile}>
            <Icon d={mobile ? ICONS.close : ICONS.menu} />
          </button>

          <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">S</span>Shop
          </Link>

          <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Main">
            <NavLink to="/" end className={linkCls}>Home</NavLink>
            <NavLink to="/products" end className={linkCls}>Shop</NavLink>
            <CategoriesMenu cats={cats} />
            <NavLink to="/products?sort=popular" className={() => linkCls({ isActive: false })}>Best sellers</NavLink>
            <NavLink to="/about" className={linkCls}>About</NavLink>
            <NavLink to="/contact" className={linkCls}>Contact</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button data-search-toggle className="btn-ghost !px-2.5" onClick={() => setSearching(true)} aria-label="Search" aria-expanded={searching}>
              <Icon d={ICONS.search} />
            </button>
            <ThemeToggle />
            <Link to="/wishlist" className="btn-ghost relative !px-2.5" aria-label="Wishlist">
              <Icon d={ICONS.heart} />
              {wishlist.size > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] text-white">{wishlist.size}</span>}
            </Link>
            <Link to="/cart" className="btn-ghost relative !px-2.5" aria-label="Cart">
              <Icon d={ICONS.cart} />
              {cart.count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{cart.count}</span>}
            </Link>
            {user ? (
              <div className="relative">
                <button className="btn-ghost !px-2.5" onClick={() => setUserMenu((m) => !m)} aria-haspopup="menu" aria-expanded={userMenu}>
                  <Icon d={ICONS.user} /><span className="hidden max-w-[7rem] truncate text-sm xl:inline">{user.name.split(' ')[0]}</span>
                </button>
                {userMenu && (
                  <div className="absolute right-0 mt-2 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" onClick={() => setUserMenu(false)} role="menu">
                    {user.role === 'ADMIN' && <Link role="menuitem" className="block px-4 py-2 text-sm font-medium text-brand-700 hover:bg-slate-100" to="/admin">Admin dashboard</Link>}
                    <Link role="menuitem" className="block px-4 py-2 text-sm hover:bg-slate-100" to="/account">My account</Link>
                    <Link role="menuitem" className="block px-4 py-2 text-sm hover:bg-slate-100" to="/orders">My orders</Link>
                    <Link role="menuitem" className="block px-4 py-2 text-sm hover:bg-slate-100" to="/wishlist">Wishlist</Link>
                    <button role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-100" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Sign in</Link>
                <Link to="/signup" className="btn-primary hidden sm:inline-flex">Sign up</Link>
              </>
            )}
          </div>
        </div>

        <SearchOverlay open={searching} onClose={closeSearch} />
      </div>

      {/* Mobile / tablet navigation (slides open) */}
      <div className={`grid transition-[grid-template-rows] duration-300 lg:hidden ${mobile && !searching ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <nav className="border-t border-slate-200 px-4 py-3" aria-label="Mobile">
            <div className="grid grid-cols-2 gap-1">
              {[['/', 'Home'], ['/products', 'Shop'], ['/products?sort=popular', 'Best sellers'], ['/about', 'About'], ['/contact', 'Contact']].map(([to, label]) => (
                <Link key={to} to={to} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">{label}</Link>
              ))}
            </div>
            <div className="mb-1 mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Categories</div>
            <div className="grid grid-cols-2 gap-1">
              {cats.map((c) => <Link key={c.id} to={`/products?category=${c.slug}`} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">{c.name}</Link>)}
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-2 text-lg font-bold">Shop</div>
          <p className="text-slate-500">Quality products, fair prices and fast, reliable delivery across India.</p>
        </div>
        <div>
          <div className="mb-2 font-semibold">Company</div>
          <ul className="space-y-1.5 text-slate-500">
            <li><Link to="/about" className="hover:text-slate-900">About us</Link></li>
            <li><Link to="/contact" className="hover:text-slate-900">Contact</Link></li>
            <li><Link to="/faq" className="hover:text-slate-900">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold">Help</div>
          <ul className="space-y-1.5 text-slate-500">
            <li><Link to="/shipping" className="hover:text-slate-900">Shipping &amp; delivery</Link></li>
            <li><Link to="/returns" className="hover:text-slate-900">Returns &amp; refunds</Link></li>
            <li><Link to="/orders" className="hover:text-slate-900">Track order</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold">Legal</div>
          <ul className="space-y-1.5 text-slate-500">
            <li><Link to="/privacy" className="hover:text-slate-900">Privacy policy</Link></li>
            <li><Link to="/terms" className="hover:text-slate-900">Terms of service</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">© {new Date().getFullYear()} Shop. Payments secured by Razorpay.</div>
    </footer>
  );
}

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6"><Outlet /></main>
      <Footer />
    </div>
  );
}
