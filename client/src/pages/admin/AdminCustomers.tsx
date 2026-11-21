import { useState } from 'react';
import { Pagination, Spinner, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';
import { date, money } from '../../lib/format';

export default function AdminCustomers() {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useAsync(() => api.get('/api/admin/customers', { page, q }), [page, q]);

  const toggle = async (c: any) => {
    if (!c.isBlocked && !window.confirm(`Suspend ${c.name}? They will be signed out and unable to log in.`)) return;
    try { await api.patch(`/api/admin/customers/${c.id}/block`, { blocked: !c.isBlocked }); toast(c.isBlocked ? 'Customer reactivated' : 'Customer suspended'); list.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Customers</h1>
      <input className="input !w-72" placeholder="Search name or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <div className="card overflow-x-auto">
        {list.loading ? <Spinner /> : (
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Customer</th><th className="th">Joined</th><th className="th">Orders</th><th className="th">Total spent</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.customers.map((c: any) => (
                <tr key={c.id}>
                  <td className="td"><div className="font-medium">{c.name}</div><div className="text-xs text-slate-400">{c.email}</div></td>
                  <td className="td text-slate-500">{date(c.createdAt)}</td><td className="td">{c.orderCount}</td><td className="td">{money(c.totalSpent)}</td>
                  <td className="td"><span className={`badge ${c.isBlocked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}>{c.isBlocked ? 'Suspended' : 'Active'}</span></td>
                  <td className="td text-right"><button className={`btn-outline btn-sm ${c.isBlocked ? '' : 'text-red-600'}`} onClick={() => toggle(c)}>{c.isBlocked ? 'Reactivate' : 'Suspend'}</button></td>
                </tr>
              ))}
              {list.data.customers.length === 0 && <tr><td className="td text-center text-slate-400" colSpan={6}>No customers found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {list.data && <Pagination page={page} pages={list.data.pages} onChange={setPage} />}
    </div>
  );
}
