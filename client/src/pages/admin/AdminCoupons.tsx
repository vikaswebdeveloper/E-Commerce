import { useState } from 'react';
import { ErrorBox, Modal, Spinner, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';
import { date, money, toPaise } from '../../lib/format';

const blank = { code: '', type: 'PERCENT', value: '10', minOrder: '0', maxDiscount: '', usageLimit: '', expiresAt: '', isActive: true };

export default function AdminCoupons() {
  const { toast } = useApp();
  const { data, loading, reload } = useAsync(() => api.get('/api/admin/coupons'), []);
  const [f, setF] = useState<any | null>(null);
  const [err, setErr] = useState('');

  const edit = (c: any) => setF({ id: c.id, code: c.code, type: c.type, value: c.type === 'FLAT' ? String(c.value / 100) : String(c.value), minOrder: String(c.minOrder / 100), maxDiscount: c.maxDiscount ? String(c.maxDiscount / 100) : '', usageLimit: c.usageLimit ? String(c.usageLimit) : '', expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '', isActive: c.isActive });

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const body = {
      code: f.code, type: f.type, value: f.type === 'FLAT' ? toPaise(f.value) : Number(f.value), minOrder: toPaise(f.minOrder || 0),
      maxDiscount: f.maxDiscount ? toPaise(f.maxDiscount) : null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
      expiresAt: f.expiresAt ? new Date(f.expiresAt + 'T23:59:59').toISOString() : null, isActive: f.isActive,
    };
    try { if (f.id) await api.put(`/api/admin/coupons/${f.id}`, body); else await api.post('/api/admin/coupons', body); setF(null); toast('Coupon saved'); reload(); } catch (e: any) { setErr(e.message); }
  };
  const del = async (id: string) => { if (window.confirm('Delete coupon?')) { await api.del(`/api/admin/coupons/${id}`); reload(); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Coupons &amp; discounts</h1><button className="btn-primary" onClick={() => { setErr(''); setF(blank); }}>+ New coupon</button></div>
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Code</th><th className="th">Discount</th><th className="th">Min order</th><th className="th">Used</th><th className="th">Expires</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.coupons.map((c: any) => (
                <tr key={c.id}>
                  <td className="td font-mono font-semibold">{c.code}</td>
                  <td className="td">{c.type === 'PERCENT' ? `${c.value}%${c.maxDiscount ? ` (max ${money(c.maxDiscount)})` : ''}` : money(c.value)}</td>
                  <td className="td">{c.minOrder ? money(c.minOrder) : '—'}</td>
                  <td className="td">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</td>
                  <td className="td">{c.expiresAt ? date(c.expiresAt) : '—'}</td>
                  <td className="td"><span className={`badge ${c.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{c.isActive ? 'Active' : 'Off'}</span></td>
                  <td className="td whitespace-nowrap text-right"><button className="btn-outline btn-sm mr-2" onClick={() => { setErr(''); edit(c); }}>Edit</button><button className="btn-outline btn-sm text-red-600" onClick={() => del(c.id)}>Delete</button></td>
                </tr>
              ))}
              {data.coupons.length === 0 && <tr><td className="td text-center text-slate-400" colSpan={7}>No coupons yet</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {f && (
        <Modal title={f.id ? 'Edit coupon' : 'New coupon'} onClose={() => setF(null)}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Code</label><input className="input uppercase" required pattern="[A-Za-z0-9_\-]{3,30}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Type</label><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="PERCENT">Percentage</option><option value="FLAT">Flat amount (₹)</option></select></div>
            <div><label className="label">{f.type === 'PERCENT' ? 'Percent off' : 'Amount off (₹)'}</label><input className="input" type="number" min="1" max={f.type === 'PERCENT' ? 100 : undefined} required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
            <div><label className="label">Min order (₹)</label><input className="input" type="number" min="0" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} /></div>
            {f.type === 'PERCENT' && <div><label className="label">Max discount (₹)</label><input className="input" type="number" min="1" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} /></div>}
            <div><label className="label">Usage limit</label><input className="input" type="number" min="1" placeholder="Unlimited" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} /></div>
            <div><label className="label">Expires on</label><input className="input" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
            <div className="sm:col-span-2"><ErrorBox msg={err} /></div>
            <div className="flex gap-2 sm:col-span-2"><button className="btn-primary">Save coupon</button><button type="button" className="btn-outline" onClick={() => setF(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
