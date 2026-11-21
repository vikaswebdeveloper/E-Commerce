import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { Empty, ErrorBox, Img, Spinner, Stars, useAsync } from '../components/ui';
import { Icon, ICONS } from '../components/Layout';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { date, discountPct, money } from '../lib/format';

export default function ProductDetail() {
  const { slug } = useParams();
  const { user, wishlist, toggleWish, setCart, toast } = useApp();
  const nav = useNavigate();
  const { data, loading, error } = useAsync(() => api.get(`/api/products/${slug}`), [slug]);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (error || !data) return <Empty title="Product not found" hint="It may have been removed." action={<Link to="/products" className="btn-primary">Browse products</Link>} />;
  const p = data.product;
  const off = discountPct(p.price, p.mrp);
  const max = Math.min(p.stock, 10);

  const add = async (buyNow = false) => {
    if (!user) return nav('/login', { state: { from: `/products/${p.slug}` } });
    setBusy(true);
    try {
      setCart(await api.post('/api/cart', { productId: p.id, quantity: qty }));
      toast('Added to cart');
      if (buyNow) nav('/checkout');
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-12">
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-slate-900">Home</Link> / <Link to={`/products?category=${p.category.slug}`} className="hover:text-slate-900">{p.category.name}</Link> / <span className="text-slate-800">{p.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
            <Img src={p.images[img]} alt={p.name} className="h-full w-full object-cover" />
          </div>
          {p.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {p.images.map((src: string, i: number) => (
                <button key={src} onClick={() => setImg(i)} aria-label={`Image ${i + 1}`} className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === img ? 'border-brand-600' : 'border-transparent'}`}>
                  <Img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {p.brand && <div className="text-sm uppercase tracking-wide text-slate-400">{p.brand}</div>}
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{p.name}</h1>
          <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Stars value={p.ratingAvg} /> <span>{p.ratingAvg.toFixed(1)} · {p.ratingCount} review{p.ratingCount === 1 ? '' : 's'}</span>
          </a>
          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{money(p.price)}</span>
            {p.mrp > p.price && <><span className="text-lg text-slate-400 line-through">{money(p.mrp)}</span><span className="badge bg-emerald-100 text-emerald-700">{off}% off</span></>}
          </div>
          <p className="mt-1 text-xs text-slate-500">Inclusive of all taxes</p>
          <p className="mt-5 leading-relaxed text-slate-600">{p.description}</p>

          <div className="mt-5 text-sm font-medium">
            {p.stock === 0 ? <span className="text-red-600">Out of stock</span> : p.stock <= 5 ? <span className="text-amber-600">Only {p.stock} left — order soon</span> : <span className="text-emerald-600">In stock</span>}
          </div>

          {p.stock > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-lg border border-slate-300">
                <button className="px-3 py-2 text-lg disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty(qty - 1)} aria-label="Decrease quantity">−</button>
                <span className="w-8 text-center text-sm" aria-live="polite">{qty}</span>
                <button className="px-3 py-2 text-lg disabled:opacity-40" disabled={qty >= max} onClick={() => setQty(qty + 1)} aria-label="Increase quantity">+</button>
              </div>
              <button className="btn-primary flex-1 sm:flex-none" disabled={busy} onClick={() => add()}>Add to cart</button>
              <button className="btn-dark flex-1 sm:flex-none" disabled={busy} onClick={() => add(true)}>Buy now</button>
              <button className="btn-outline !px-3" aria-label="Toggle wishlist" onClick={() => (user ? toggleWish(p.id) : nav('/login', { state: { from: `/products/${p.slug}` } }))}>
                <Icon d={ICONS.heart} className={`h-5 w-5 ${wishlist.has(p.id) ? 'fill-rose-500 stroke-rose-500' : ''}`} />
              </button>
            </div>
          )}

          <ul className="mt-8 space-y-2 border-t border-slate-200 pt-5 text-sm text-slate-600">
            <li>🚚 Free delivery on orders above ₹999</li>
            <li>↩️ 7-day easy returns</li>
            <li>🔒 Secure payment via Razorpay or Cash on Delivery</li>
          </ul>
        </div>
      </div>

      <Reviews productId={p.id} onChange={() => undefined} />

      {data.related.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">You may also like</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{data.related.map((r: any) => <ProductCard key={r.id} p={r} />)}</div>
        </section>
      )}
    </div>
  );
}

function Reviews({ productId }: { productId: string; onChange: () => void }) {
  const { user, toast } = useApp();
  const { data, loading, reload } = useAsync(() => api.get(`/api/reviews/product/${productId}`), [productId, user?.id]);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = data?.reviews.find((r: any) => r.mine);
  const total = data?.distribution.reduce((s: number, d: any) => s + d.count, 0) ?? 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!rating) return setErr('Please select a star rating');
    setBusy(true);
    try {
      await api.put(`/api/reviews/product/${productId}`, { rating, title: title || undefined, comment });
      toast('Thanks for your review!');
      setComment(''); setTitle(''); setRating(0);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await api.del(`/api/reviews/product/${productId}`);
    toast('Review deleted');
    reload();
  };

  return (
    <section id="reviews" className="scroll-mt-24">
      <h2 className="mb-5 text-xl font-semibold">Ratings &amp; reviews</h2>
      {loading ? <Spinner /> : (
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <div className="card h-fit space-y-2 p-5">
            {[...data.distribution].reverse().map((d: any) => (
              <div key={d.stars} className="flex items-center gap-2 text-sm">
                <span className="w-6">{d.stars}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full bg-amber-400" style={{ width: `${total ? (d.count / total) * 100 : 0}%` }} /></div>
                <span className="w-6 text-right text-slate-500">{d.count}</span>
              </div>
            ))}
          </div>
          <div className="space-y-6">
            {user ? (
              <form onSubmit={submit} className="card space-y-3 p-5">
                <h3 className="font-semibold">{mine ? 'Update your review' : 'Write a review'}</h3>
                <Stars value={rating} size={26} onChange={setRating} />
                <input className="input" placeholder="Title (optional)" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea className="input" rows={3} placeholder="Share your experience with this product" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} required minLength={3} />
                <ErrorBox msg={err} />
                <button className="btn-dark" disabled={busy}>{mine ? 'Update review' : 'Submit review'}</button>
              </form>
            ) : (
              <div className="card p-5 text-sm"><Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link> to write a review.</div>
            )}
            {data.reviews.length === 0 ? <p className="text-sm text-slate-500">No reviews yet. Be the first to review this product.</p> : data.reviews.map((r: any) => (
              <article key={r.id} className="border-b border-slate-200 pb-5">
                <div className="flex items-center gap-2"><Stars value={r.rating} size={14} />{r.title && <span className="font-medium">{r.title}</span>}</div>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{r.comment}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{r.userName}</span><span>·</span><span>{date(r.createdAt)}</span>
                  {r.verifiedPurchase && <span className="badge bg-emerald-50 text-emerald-700">Verified purchase</span>}
                  {r.mine && <button onClick={remove} className="text-red-500 hover:underline">Delete</button>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
