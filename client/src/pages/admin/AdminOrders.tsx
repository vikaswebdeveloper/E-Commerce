import { useState } from 'react';
import { Modal, Pagination, Spinner, StatusBadge, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';

const NEXT: Record<string, string[]> = { PAID: ['PROCESSING', 'SHIPPED', 'CANCELLED'], PROCESSING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED'], PENDING_PAYMENT: ['CANCELLED'] };
const STATUSES = ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];

export default function AdminOrders() {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<any | null>(null);
  const list = useAsync(() => api.get('/api/admin/orders', { page, q, status }), [page, q, status]);

  const setOrderStatus = async (o: any, s: string) => {
    if (s === 'CANCELLED' && !window.confirm('Cancel this order? Stock is restored and paid online orders are refunded.')) return;
    try { const r = await api.patch(`/api/admin/orders/${o.id}/status`, { status: s }); setOpen({ ...o, ...r.order, user: o.user }); toast(`Order marked ${s.toLowerCase()}`); list.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Orders</h1>
      <div className="flex flex-wrap gap-2">
        <input className="input !w-64" placeholder="Search order ID, name or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input !w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <div className="card overflow-x-auto">
        {list.loading ? <Spinner /> : (
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Order</th><th className="th">Customer</th><th className="th">Date</th><th className="th">Payment</th><th className="th">Status</th><th className="th text-right">Total</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.orders.map((o: any) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs">#{o.id.slice(-8).toUpperCase()}</td>
                  <td className="td"><div>{o.user.name}</div><div className="text-xs text-slate-400">{o.user.email}</div></td>
                  <td className="td text-slate-500">{dateTime(o.createdAt)}</td>
                  <td className="td text-xs">{o.paymentMethod}<br /><span className="text-slate-400">{o.paymentStatus.toLowerCase()}</span></td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                  <td className="td text-right font-medium">{money(o.total)}</td>
                  <td className="td text-right"><button className="btn-outline btn-sm" onClick={() => setOpen(o)}>Manage</button></td>
                </tr>
              ))}
              {list.data.orders.length === 0 && <tr><td className="td text-center text-slate-400" colSpan={7}>No orders found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {list.data && <Pagination page={page} pages={list.data.pages} onChange={setPage} />}

      {open && (
        <Modal title={`Order #${open.id.slice(-8).toUpperCase()}`} onClose={() => setOpen(null)} wide>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={open.status} /><span className="text-slate-500">{dateTime(open.createdAt)}</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><div className="font-semibold">Customer</div>{open.user.name}<br />{open.user.email}</div>
              <div><div className="font-semibold">Ship to</div>{open.shippingAddress.fullName}, {open.shippingAddress.line1}{open.shippingAddress.line2 ? `, ${open.shippingAddress.line2}` : ''}, {open.shippingAddress.city}, {open.shippingAddress.state} – {open.shippingAddress.pincode}<br />📞 {open.shippingAddress.phone}</div>
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {open.items.map((i: any) => <li key={i.id} className="flex justify-between px-3 py-2"><span>{i.name} × {i.quantity}</span><span>{money(i.price * i.quantity)}</span></li>)}
              <li className="flex justify-between bg-slate-50 px-3 py-2 font-semibold"><span>Total {open.couponCode && <span className="font-normal text-emerald-600">({open.couponCode} −{money(open.discount)})</span>}</span><span>{money(open.total)}</span></li>
            </ul>
            <div className="text-xs text-slate-500">Payment: {open.paymentMethod} · {open.paymentStatus}{open.razorpayPaymentId && ` · ${open.razorpayPaymentId}`}</div>
            {NEXT[open.status] ? (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                {NEXT[open.status].map((s) => <button key={s} className={s === 'CANCELLED' ? 'btn-outline text-red-600' : 'btn-dark'} onClick={() => setOrderStatus(open, s)}>{s === 'CANCELLED' ? 'Cancel order' : `Mark ${s.toLowerCase()}`}</button>)}
              </div>
            ) : <p className="border-t border-slate-100 pt-4 text-slate-400">This order is in a final state.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
