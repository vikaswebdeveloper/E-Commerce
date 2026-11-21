import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, Empty, ErrorBox, Img, Spinner, StatusBadge, useAsync } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';

const STEPS = ['PROCESSING', 'SHIPPED', 'DELIVERED'];

export default function OrderDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { toast } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/orders/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (loading) return <Spinner />;
  if (error || !data) return <Empty title="Order not found" action={<Link to="/orders" className="btn-primary">My orders</Link>} />;
  const o = data.order;
  const a = o.shippingAddress;
  const stepIdx = o.status === 'PAID' ? -1 : STEPS.indexOf(o.status);
  const cancellable = ['PENDING_PAYMENT', 'PAID', 'PROCESSING'].includes(o.status);

  const cancel = async () => {
    if (!window.confirm('Cancel this order?' + (o.paymentStatus === 'PAID' && o.paymentMethod === 'RAZORPAY' ? ' Your payment will be refunded.' : ''))) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/api/orders/${o.id}/cancel`);
      toast('Order cancelled');
      reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const payNow = async () => {
    setBusy(true); setErr('');
    try {
      const { payment } = await api.post(`/api/orders/${o.id}/pay`);
      if (payment.keyId === 'rzp_mock_key') {
        if (!window.confirm(`MOCK PAYMENT — pay ${money(payment.amount)}?`)) return;
        const sig = await api.post('/api/payments/mock-pay', { razorpayOrderId: payment.razorpayOrderId });
        await api.post('/api/payments/verify', sig);
        toast('Payment successful');
        reload();
        return;
      }
      if (!window.Razorpay) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = () => res(); s.onerror = () => rej(new Error('Could not load payment window'));
          document.body.appendChild(s);
        });
      }
      new window.Razorpay({
        key: payment.keyId, amount: payment.amount, currency: payment.currency, order_id: payment.razorpayOrderId, name: 'Shop',
        theme: { color: '#4f46e5' },
        handler: async (r: any) => { try { await api.post('/api/payments/verify', r); toast('Payment successful'); reload(); } catch (e: any) { setErr(e.message); } },
      }).open();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <BackLink to="/orders">All orders</BackLink>
      {sp.get('placed') && (
        <div className="rounded-xl bg-emerald-50 p-5 text-emerald-900">
          <div className="text-lg font-semibold">🎉 Thank you — your order has been placed!</div>
          <p className="mt-1 text-sm">We've sent a confirmation and will notify you when it ships.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Order #{o.id.slice(-8).toUpperCase()}</h1>
          <p className="text-sm text-slate-500">Placed on {dateTime(o.createdAt)}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {stepIdx >= 0 && (
        <div className="card p-5">
          <ol className="flex items-center">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-1 items-center last:flex-none">
                <div className={`grid h-8 w-8 place-items-center rounded-full text-sm ${i <= stepIdx ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{i <= stepIdx ? '✓' : i + 1}</div>
                <span className="ml-2 hidden text-sm sm:inline">{s[0] + s.slice(1).toLowerCase()}</span>
                {i < STEPS.length - 1 && <div className={`mx-3 h-0.5 flex-1 ${i < stepIdx ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card divide-y divide-slate-100">
          {o.items.map((i: any) => (
            <div key={i.id} className="flex items-center gap-4 p-4">
              <Img src={i.image ?? ''} alt={i.name} className="h-16 w-16 rounded-lg object-cover" />
              <div className="flex-1"><Link to={`/products/${i.productId}`} className="font-medium hover:text-brand-700">{i.name}</Link><div className="text-sm text-slate-500">{money(i.price)} × {i.quantity}</div></div>
              <div className="font-medium">{money(i.price * i.quantity)}</div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Payment</h2>
            <div className="flex justify-between"><span className="text-slate-500">Method</span><span>{o.paymentMethod === 'COD' ? 'Cash on delivery' : 'Razorpay'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Status</span><span>{o.paymentStatus.toLowerCase()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(o.subtotal)}</span></div>
            {o.discount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount {o.couponCode && `(${o.couponCode})`}</span><span>−{money(o.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span>{o.shipping ? money(o.shipping) : 'Free'}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Total</span><span>{money(o.total)}</span></div>
          </div>
          <div className="card p-5 text-sm">
            <h2 className="mb-1 font-semibold">Delivery address</h2>
            <div className="text-slate-600">{a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.state} – {a.pincode}<br />📞 {a.phone}</div>
          </div>
          <ErrorBox msg={err} />
          {o.status === 'PENDING_PAYMENT' && <button className="btn-primary w-full" disabled={busy} onClick={payNow}>Complete payment · {money(o.total)}</button>}
          {cancellable && <button className="btn-outline w-full text-red-600" disabled={busy} onClick={cancel}>Cancel order</button>}
        </div>
      </div>
    </div>
  );
}
