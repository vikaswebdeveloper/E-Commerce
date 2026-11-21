import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { Img, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { money } from '../lib/format';

export default function Home() {
  const cats = useAsync(() => api.get('/api/categories'), []);
  const featured = useAsync(() => api.get('/api/products', { featured: 'true', limit: 8 }), []);
  const popular = useAsync(() => api.get('/api/products', { sort: 'popular', limit: 8 }), []);
  const newest = useAsync(() => api.get('/api/products', { sort: 'newest', limit: 8 }), []);

  return (
    <div className="space-y-14">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-ink-800 to-indigo-700 px-6 py-12 text-white sm:px-12 sm:py-16">
        {/* soft decorative glows */}
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-indigo-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-1/3 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />

        <div className="relative grid items-center gap-10 md:grid-cols-2">
        <div className="max-w-xl">
          <span className="badge bg-white/10 text-white">Free delivery over ₹999</span>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-5xl">Everything you need, delivered with care.</h1>
          <p className="mt-4 text-ink-300">Discover curated products across electronics, fashion, home and more — at honest prices, with secure checkout.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/products" className="btn bg-[#ffffff] text-ink-900 hover:bg-[#f1f5f9]">Shop now</Link>
            <Link to="/products?sort=popular" className="btn border border-white/30 text-white hover:bg-white/10">Best sellers</Link>
          </div>
        </div>

        {/* Product showcase: real products from the catalog, so the banner never looks empty. */}
        <div className="hidden pb-6 md:block" aria-label="Featured products">
          <div className="mx-auto grid max-w-md grid-cols-2 gap-4">
            {(newest.data?.items ?? []).slice(0, 4).map((p: any, i: number) => (
              <Link
                key={p.id}
                to={`/products/${p.slug}`}
                className={`group rounded-2xl bg-white/10 p-2 ring-1 ring-white/15 backdrop-blur transition hover:-translate-y-1 hover:bg-white/15 ${i % 2 ? 'translate-y-6' : ''}`}
              >
                <Img src={p.images?.[0]} alt={p.name} className="aspect-square w-full rounded-xl object-cover" />
                <div className="px-1 pb-1 pt-2">
                  <div className="truncate text-sm font-medium text-white">{p.name}</div>
                  <div className="text-xs text-ink-300">{money(p.price)}</div>
                </div>
              </Link>
            ))}
            {newest.loading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`aspect-[4/5] animate-pulse rounded-2xl bg-white/10 ${i % 2 ? 'translate-y-6' : ''}`} />
            ))}
          </div>
        </div>
        </div>
      </section>

      {/* Products are shown straight away on the home page, no extra click needed. */}
      <Row title="New arrivals" to="/products?sort=newest" state={newest} />

      <section>
        <h2 className="mb-4 text-xl font-semibold">Shop by category</h2>
        {cats.loading ? <Spinner /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cats.data?.categories.map((c: any) => (
              <Link key={c.id} to={`/products?category=${c.slug}`} className="card px-4 py-5 text-center transition hover:border-brand-500 hover:shadow-sm">
                <div className="font-medium">{c.name}</div>
                <div className="mt-0.5 text-xs text-slate-400">{c.productCount} items</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Row title="Featured" to="/products?featured=true" state={featured} />
      <Row title="Best sellers" to="/products?sort=popular" state={popular} />

      <section className="grid gap-4 sm:grid-cols-3">
        {[['🚚', 'Fast delivery', 'Dispatched within 24 hours'], ['🔒', 'Secure payments', 'Powered by Razorpay'], ['↩️', 'Easy returns', '7-day hassle-free returns']].map(([i, t, d]) => (
          <div key={t} className="card flex items-center gap-4 p-5">
            <div className="text-3xl">{i}</div>
            <div><div className="font-semibold">{t}</div><div className="text-sm text-slate-500">{d}</div></div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Row({ title, to, state }: { title: string; to: string; state: ReturnType<typeof useAsync<any>> }) {
  const items: any[] = state.data?.items ?? [];
  if (!state.loading && items.length === 0) return null;
  return (
    <section>
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Link to={to} className="text-sm font-medium text-brand-600 hover:underline">View all →</Link>
      </div>
      {state.loading ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      )}
    </section>
  );
}
