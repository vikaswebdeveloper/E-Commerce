import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorBox, Img, Spinner, useAsync } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { AddressForm } from './Account';
import { FREE_SHIPPING, SHIPPING_FEE } from './Cart';

declare global {
  interface Window { Razorpay?: any }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function Checkout() {
  const { cart, user, refreshCart, toast } = useApp();
  const nav = useNavigate();
  const addrs = useAsync(() => api.get('/api/addresses'), []);
  const [addressId, setAddressId] = useState('');
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<'RAZORPAY' | 'COD'>('RAZORPAY');
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponErr, setCouponErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const list = addrs.data?.addresses;
    if (list?.length && !addressId) setAddressId((list.find((a: any) => a.isDefault) ?? list[0]).id);
  }, [addrs.data, addressId]);

  if (cart.items.length === 0 && !busy) return <Navigate to="/cart" replace />;

  const discount = applied?.discount ?? 0;
  const after = cart.subtotal - discount;
  const shipping = after >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
  const total = after + shipping;

  const applyCoupon = async () => {
    setCouponErr('');
    try {
      const r = await api.post('/api/coupons/validate', { code });
      setApplied({ code: r.code, discount: r.discount });
      toast(`Coupon ${r.code} applied`);
    } catch (e: any) {
      setApplied(null);
      setCouponErr(e.message);
    }
  };

  const verify = async (payload: any, orderId: string) => {
    try {
      await api.post('/api/payments/verify', payload);
      await refreshCart();
      nav(`/orders/${orderId}?placed=1`, { replace: true });
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const pay = async (order: any, payment: any) => {
    if (payment.keyId === 'rzp_mock_key') {
      // Development mock gateway (server has no Razorpay keys configured).
      if (!window.confirm(`MOCK PAYMENT\n\nPay ${money(payment.amount)} for this order?\n(Razorpay keys are not configured — this simulates a successful payment.)`)) {
        setErr('Payment cancelled. Your order is saved — you can complete payment from "My orders".');
        setBusy(false);
        await refreshCart();
        return nav(`/orders/${order.id}`);
      }
      const sig = await api.post('/api/payments/mock-pay', { razorpayOrderId: payment.razorpayOrderId });
      return verify(sig, order.id);
    }
    if (!(await loadRazorpay())) {
      setErr('Could not load the payment window. Check your connection and retry from "My orders".');
      setBusy(false);
      return;
    }
    const rzp = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency,
      order_id: payment.razorpayOrderId,
      name: 'Shop',
      description: `Order ${order.id.slice(-8).toUpperCase()}`,
      prefill: { name: user?.name, email: user?.email },
      theme: { color: '#4f46e5' },
      handler: (r: any) => verify(r, order.id),
      modal: {
        ondismiss: async () => {
          await refreshCart();
          toast('Payment not completed. You can retry from "My orders".', 'err');
          nav(`/orders/${order.id}`);
        },
      },
    });
    rzp.on('payment.failed', (r: any) => setErr(r?.error?.description ?? 'Payment failed'));
    rzp.open();
  };

  const place = async () => {
    setErr('');
    if (!addressId) return setErr('Please add or select a delivery address');
    setBusy(true);
    try {
      const r = await api.post('/api/orders', { addressId, paymentMethod: method, couponCode: applied?.code });
      if (method === 'COD') {
        await refreshCart();
        return nav(`/orders/${r.order.id}?placed=1`, { replace: true });
      }
      await pay(r.order, r.payment);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
      refreshCart();
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Checkout</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">1. Delivery address</h2>{!adding && <button className="text-sm font-medium text-brand-600" onClick={() => setAdding(true)}>+ Add new</button>}</div>
            {addrs.loading ? <Spinner /> : adding ? (
              <AddressForm onCancel={() => setAdding(false)} onSaved={(a) => { addrs.reload(); setAddressId(a.id); setAdding(false); }} />
            ) : addrs.data?.addresses.length === 0 ? (
              <p className="text-sm text-slate-500">No saved addresses yet — add one to continue.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {addrs.data.addresses.map((a: any) => (
                  <label key={a.id} className={`cursor-pointer rounded-lg border p-3 text-sm ${addressId === a.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                    <input type="radio" className="mr-2" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                    <b>{a.fullName}</b> · {a.phone}
                    <div className="mt-1 text-slate-600">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} – {a.pincode}</div>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">2. Payment method</h2>
            <div className="space-y-2">
              {([['RAZORPAY', 'Pay online', 'UPI, cards, net banking & wallets via Razorpay'], ['COD', 'Cash on delivery', 'Pay when your order arrives']] as const).map(([v, t, d]) => (
                <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${method === v ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                  <input type="radio" name="pm" className="mt-1" checked={method === v} onChange={() => setMethod(v)} />
                  <span><span className="block text-sm font-medium">{t}</span><span className="text-xs text-slate-500">{d}</span></span>
                </label>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">3. Review items</h2>
            <ul className="divide-y divide-slate-100">
              {cart.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                  <Img src={i.product.images[0]} alt="" className="h-14 w-14 rounded object-cover" />
                  <div className="flex-1"><div className="font-medium">{i.product.name}</div><div className="text-slate-500">Qty {i.quantity}</div></div>
                  <div className="font-medium">{money(i.product.price * i.quantity)}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="card h-fit space-y-3 p-5">
          <h2 className="font-semibold">Order summary</h2>
          <div className="flex gap-2">
            <input className="input" placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={30} aria-label="Coupon code" />
            <button className="btn-outline" onClick={applyCoupon} disabled={!code}>Apply</button>
          </div>
          {couponErr && <p className="text-xs text-red-600">{couponErr}</p>}
          {applied && <p className="text-xs text-emerald-600">✓ {applied.code} applied · <button className="underline" onClick={() => { setApplied(null); setCode(''); }}>remove</button></p>}
          <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(cart.subtotal)}</span></div>
            {discount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>−{money(discount)}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span>{shipping === 0 ? 'Free' : money(shipping)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><span>Total</span><span>{money(total)}</span></div>
          </div>
          <ErrorBox msg={err} />
          <button className="btn-primary w-full" disabled={busy || !addressId} onClick={place}>{busy ? 'Processing…' : method === 'COD' ? 'Place order' : `Pay ${money(total)}`}</button>
          <p className="text-center text-xs text-slate-400">Final amount is confirmed securely on the server. <Link to="/cart" className="underline">Edit cart</Link></p>
        </aside>
      </div>
    </div>
  );
}
