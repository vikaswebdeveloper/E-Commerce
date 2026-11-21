import { Link } from 'react-router-dom';
import { Spinner, StatusBadge, useAsync } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';

export default function Dashboard() {
  const { data: d, loading, error } = useAsync(() => api.get('/api/admin/stats'), []);
  if (loading) return <Spinner />;
  if (error) return <p className="text-red-600">{error}</p>;
  const maxRev = Math.max(1, ...d.salesByDay.map((s: any) => s.revenue));

  const cards = [
    ['Revenue', money(d.revenue), 'Paid orders'], ['Orders', d.orders, 'All time'], ['Customers', d.customers, 'Registered'], ['Active products', d.products, 'In catalog'],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([t, v, s]) => (
          <div key={t as string} className="card p-5"><div className="text-sm text-slate-500">{t}</div><div className="mt-1 text-2xl font-bold">{v}</div><div className="text-xs text-slate-400">{s}</div></div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card p-5 xl:col-span-2">
          <h2 className="mb-4 font-semibold">Revenue — last 7 days</h2>
          <div className="flex h-48 items-end gap-3" role="img" aria-label="Revenue bar chart">
            {d.salesByDay.map((s: any) => (
              <div key={s.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-[10px] text-slate-400">{s.revenue ? money(s.revenue) : ''}</div>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${(s.revenue / maxRev) * 100}%`, minHeight: s.revenue ? 4 : 2, opacity: s.revenue ? 1 : 0.2 }} title={`${s.orders} orders`} />
                <div className="text-xs text-slate-500">{new Date(s.date).toLocaleDateString('en-IN', { weekday: 'short' })}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Orders by status</h2>
          <ul className="space-y-2 text-sm">
            {d.statusCounts.length === 0 && <li className="text-slate-400">No orders yet</li>}
            {d.statusCounts.map((s: any) => <li key={s.status} className="flex items-center justify-between"><StatusBadge status={s.status} /><b>{s.count}</b></li>)}
          </ul>
        </section>

        <section className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between p-5 pb-3"><h2 className="font-semibold">Recent orders</h2><Link className="text-sm text-brand-600" to="/admin/orders">View all</Link></div>
          <table className="w-full"><tbody className="divide-y divide-slate-100">
            {d.recentOrders.map((o: any) => (
              <tr key={o.id}><td className="td font-mono text-xs">#{o.id.slice(-8).toUpperCase()}</td><td className="td">{o.customer}</td><td className="td text-slate-500">{dateTime(o.createdAt)}</td><td className="td"><StatusBadge status={o.status} /></td><td className="td text-right font-medium">{money(o.total)}</td></tr>
            ))}
          </tbody></table>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Low stock</h2>
          <ul className="space-y-2 text-sm">
            {d.lowStock.length === 0 && <li className="text-slate-400">All products well stocked 🎉</li>}
            {d.lowStock.map((p: any) => <li key={p.id} className="flex justify-between"><span className="truncate pr-2">{p.name}</span><b className={p.stock === 0 ? 'text-red-600' : 'text-amber-600'}>{p.stock}</b></li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
