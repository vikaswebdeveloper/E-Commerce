import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { Empty, Pagination, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { toPaise } from '../lib/format';

const SORTS = [
  ['newest', 'Newest'], ['popular', 'Popularity'], ['rating', 'Top rated'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'],
];

export default function Products() {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const [min, setMin] = useState(get('minPrice') ? String(Number(get('minPrice')) / 100) : '');
  const [max, setMax] = useState(get('maxPrice') ? String(Number(get('maxPrice')) / 100) : '');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const cats = useAsync(() => api.get('/api/categories'), []);
  const meta = useAsync(() => api.get('/api/products/meta'), []);
  const params = Object.fromEntries(sp.entries());
  const list = useAsync(() => api.get('/api/products', { ...params, limit: 12 }), [sp.toString()]);

  useEffect(() => {
    setMin(get('minPrice') ? String(Number(get('minPrice')) / 100) : '');
    setMax(get('maxPrice') ? String(Number(get('maxPrice')) / 100) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()]);

  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (!('page' in patch)) n.delete('page');
    setSp(n);
  };
  const applyPrice = () => set({ minPrice: min ? String(toPaise(min)) : '', maxPrice: max ? String(toPaise(max)) : '' });
  const active = ['q', 'category', 'brand', 'minPrice', 'maxPrice', 'rating', 'inStock'].filter((k) => sp.get(k));

  const Filters = (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Category</h3>
        <ul className="space-y-1 text-sm">
          <li><button className={!get('category') ? 'font-semibold text-brand-700' : 'text-slate-600'} onClick={() => set({ category: '' })}>All</button></li>
          {cats.data?.categories.map((c: any) => (
            <li key={c.id}><button className={get('category') === c.slug ? 'font-semibold text-brand-700' : 'text-slate-600 hover:text-slate-900'} onClick={() => set({ category: c.slug })}>{c.name} <span className="text-slate-400">({c.productCount})</span></button></li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Price (₹)</h3>
        <div className="flex items-center gap-2">
          <input className="input !px-2 !py-1.5" inputMode="numeric" placeholder={`Min`} value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} aria-label="Minimum price" />
          <span className="text-slate-400">–</span>
          <input className="input !px-2 !py-1.5" inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} aria-label="Maximum price" />
        </div>
        <button className="btn-outline btn-sm mt-2 w-full" onClick={applyPrice}>Apply</button>
      </div>
      {meta.data?.brands?.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Brand</h3>
          <ul className="space-y-1.5 text-sm">
            {meta.data.brands.map((b: string) => (
              <li key={b}><label className="flex cursor-pointer items-center gap-2"><input type="radio" name="brand" checked={get('brand') === b} onChange={() => set({ brand: get('brand') === b ? '' : b })} onClick={() => get('brand') === b && set({ brand: '' })} /> {b}</label></li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Customer rating</h3>
        <ul className="space-y-1.5 text-sm">
          {[4, 3, 2].map((r) => (
            <li key={r}><label className="flex cursor-pointer items-center gap-2"><input type="radio" name="rating" checked={get('rating') === String(r)} onChange={() => set({ rating: String(r) })} /> {r}★ &amp; up</label></li>
          ))}
        </ul>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={get('inStock') === 'true'} onChange={(e) => set({ inStock: e.target.checked ? 'true' : '' })} /> In stock only</label>
      {active.length > 0 && <button className="btn-ghost btn-sm w-full" onClick={() => setSp({})}>Clear all filters</button>}
    </div>
  );

  const page = Number(get('page') || 1);
  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:block">{Filters}</aside>
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{get('q') ? `Results for “${get('q')}”` : get('category') ? cats.data?.categories.find((c: any) => c.slug === get('category'))?.name ?? 'Products' : 'All products'}</h1>
            <p className="text-sm text-slate-500">{list.data ? `${list.data.total} products` : ' '}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-outline btn-sm lg:hidden" onClick={() => setFiltersOpen((o) => !o)}>Filters{active.length ? ` (${active.length})` : ''}</button>
            <select className="input !w-auto !py-1.5" value={get('sort') || 'newest'} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        {filtersOpen && <div className="card mb-4 p-4 lg:hidden">{Filters}</div>}
        {list.loading ? <Spinner /> : list.error ? <Empty title="Something went wrong" hint={list.error} /> : list.data!.items.length === 0 ? (
          <Empty title="No products found" hint="Try adjusting your search or clearing some filters." action={<button className="btn-primary" onClick={() => setSp({})}>Clear filters</button>} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{list.data!.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
            <Pagination page={page} pages={list.data!.pages} onChange={(p) => set({ page: String(p) })} />
          </>
        )}
      </div>
    </div>
  );
}
