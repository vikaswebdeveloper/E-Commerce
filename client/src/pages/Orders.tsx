import { Link } from 'react-router-dom';
import { Empty, Img, Spinner, StatusBadge, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { date, money } from '../lib/format';

export default function Orders() {
  const { data, loading } = useAsync(() => api.get('/api/orders'), []);
  if (loading) return <Spinner />;
  const orders: any[] = data?.orders ?? [];
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">My orders</h1>
      {orders.length === 0 ? (
        <Empty title="No orders yet" hint="When you place an order, it will show up here." action={<Link to="/products" className="btn-primary">Start shopping</Link>} />
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-500">
                  <span>Placed <b className="text-slate-800">{date(o.createdAt)}</b></span>
                  <span>Total <b className="text-slate-800">{money(o.total)}</b></span>
                  <span>Order # <b className="text-slate-800">{o.id.slice(-8).toUpperCase()}</b></span>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="flex -space-x-2">
                  {o.items.slice(0, 4).map((i: any) => <Img key={i.id} src={i.image ?? ''} alt={i.name} className="h-12 w-12 rounded-lg border-2 border-white object-cover" />)}
                  {o.items.length > 4 && <span className="grid h-12 w-12 place-items-center rounded-lg border-2 border-white bg-slate-100 text-xs">+{o.items.length - 4}</span>}
                </div>
                <Link to={`/orders/${o.id}`} className="btn-outline btn-sm">View details</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
