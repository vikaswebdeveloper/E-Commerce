import { useState } from 'react';
import { Pagination, Spinner, Stars, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';
import { date } from '../../lib/format';

export default function AdminReviews() {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get('/api/admin/reviews', { page }), [page]);
  const del = async (id: string) => {
    if (!window.confirm('Delete this review?')) return;
    try { await api.del(`/api/admin/reviews/${id}`); toast('Review removed'); list.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reviews</h1>
      {list.loading ? <Spinner /> : (
        <div className="card divide-y divide-slate-100">
          {list.data.reviews.map((r: any) => (
            <div key={r.id} className="flex items-start justify-between gap-4 p-4">
              <div className="text-sm">
                <div className="flex items-center gap-2"><Stars value={r.rating} size={14} /><b>{r.title}</b></div>
                <p className="mt-1 text-slate-700">{r.comment}</p>
                <div className="mt-1 text-xs text-slate-400">{r.user.name} on “{r.product.name}” · {date(r.createdAt)}</div>
              </div>
              <button className="btn-outline btn-sm text-red-600" onClick={() => del(r.id)}>Delete</button>
            </div>
          ))}
          {list.data.reviews.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No reviews yet</p>}
        </div>
      )}
      {list.data && <Pagination page={page} pages={list.data.pages} onChange={setPage} />}
    </div>
  );
}
