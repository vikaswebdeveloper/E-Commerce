import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { discountPct, money } from '../lib/format';
import { Icon, ICONS } from './Layout';
import { Img, Stars } from './ui';

export default function ProductCard({ p }: { p: any }) {
  const { user, wishlist, toggleWish, setCart, toast } = useApp();
  const nav = useNavigate();
  const off = discountPct(p.price, p.mrp);
  const wished = wishlist.has(p.id);

  const requireLogin = () => {
    nav('/login', { state: { from: `/products/${p.slug}` } });
  };

  const add = async () => {
    if (!user) return requireLogin();
    try {
      setCart(await api.post('/api/cart', { productId: p.id, quantity: 1 }));
      toast('Added to cart');
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  return (
    <div className="card group flex flex-col overflow-hidden transition hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        <Link to={`/products/${p.slug}`}>
          <Img src={p.images?.[0]} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        </Link>
        {off > 0 && <span className="badge absolute left-2 top-2 bg-emerald-600 text-white">{off}% off</span>}
        <button
          onClick={() => (user ? toggleWish(p.id) : requireLogin())}
          aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-pressed={wished}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 shadow hover:bg-white"
        >
          <Icon d={ICONS.heart} className={`h-4 w-4 ${wished ? 'fill-rose-500 stroke-rose-500' : 'text-slate-600'}`} />
        </button>
        {p.stock === 0 && <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-medium text-white">Out of stock</div>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        {p.brand && <div className="text-xs uppercase tracking-wide text-slate-400">{p.brand}</div>}
        <Link to={`/products/${p.slug}`} className="mt-0.5 line-clamp-2 text-sm font-medium text-slate-900 hover:text-brand-700">{p.name}</Link>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <Stars value={p.ratingAvg} size={13} /> <span>({p.ratingCount})</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-semibold">{money(p.price)}</span>
          {p.mrp > p.price && <span className="text-xs text-slate-400 line-through">{money(p.mrp)}</span>}
        </div>
        <button className="btn-dark btn-sm mt-3" disabled={p.stock === 0} onClick={add}>{p.stock === 0 ? 'Unavailable' : 'Add to cart'}</button>
      </div>
    </div>
  );
}
