import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Img } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { money } from '../lib/format';

export const FREE_SHIPPING = 99900;
export const SHIPPING_FEE = 4900;

export default function Cart() {
  const { cart, setCart, toast } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState('');

  const update = async (productId: string, quantity: number) => {
    setBusy(productId);
    try {
      setCart(await api.put(`/api/cart/${productId}`, { quantity }));
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const remove = async (productId: string) => setCart(await api.del(`/api/cart/${productId}`));

  if (cart.items.length === 0)
    return <Empty title="Your cart is empty" hint="Looks like you haven't added anything yet." action={<Link to="/products" className="btn-primary">Start shopping</Link>} />;

  const shipping = cart.subtotal >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
  const blocked = cart.items.some((i) => !i.available);
  const remaining = FREE_SHIPPING - cart.subtotal;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Shopping cart</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="space-y-3">
          {cart.items.map((i) => (
            <li key={i.id} className="card flex gap-4 p-4">
              <Link to={`/products/${i.product.slug}`}><Img src={i.product.images[0]} alt={i.product.name} className="h-24 w-24 rounded-lg object-cover" /></Link>
              <div className="flex flex-1 flex-col">
                <Link to={`/products/${i.product.slug}`} className="font-medium hover:text-brand-700">{i.product.name}</Link>
                <div className="mt-1 text-sm text-slate-500">{money(i.product.price)} each</div>
                {!i.available && <div className="mt-1 text-sm font-medium text-red-600">Only {i.product.stock} available — please reduce quantity</div>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <div className="inline-flex items-center rounded-lg border border-slate-300">
                    <button className="px-3 py-1 disabled:opacity-40" disabled={i.quantity <= 1 || busy === i.productId} onClick={() => update(i.productId, i.quantity - 1)} aria-label="Decrease quantity">−</button>
                    <span className="w-8 text-center text-sm">{i.quantity}</span>
                    <button className="px-3 py-1 disabled:opacity-40" disabled={i.quantity >= Math.min(i.product.stock, 20) || busy === i.productId} onClick={() => update(i.productId, i.quantity + 1)} aria-label="Increase quantity">+</button>
                  </div>
                  <div className="flex items-center gap-4">
                    <button className="text-sm text-slate-500 hover:text-red-600" onClick={() => remove(i.productId)}>Remove</button>
                    <span className="font-semibold">{money(i.product.price * i.quantity)}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="card h-fit space-y-3 p-5">
          <h2 className="font-semibold">Order summary</h2>
          {remaining > 0 && <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">Add {money(remaining)} more for free delivery</div>}
          <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal ({cart.count} items)</span><span>{money(cart.subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Delivery</span><span>{shipping === 0 ? 'Free' : money(shipping)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold"><span>Total</span><span>{money(cart.subtotal + shipping)}</span></div>
          <p className="text-xs text-slate-400">Coupons can be applied at checkout.</p>
          <button className="btn-primary w-full" disabled={blocked} onClick={() => nav('/checkout')}>Proceed to checkout</button>
        </aside>
      </div>
    </div>
  );
}
