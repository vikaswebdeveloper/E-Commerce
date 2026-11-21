import { useState } from 'react';
import { Pagination, Spinner, useAsync } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';

export default function AdminAudit() {
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get('/api/admin/audit', { page, limit: 25 }), [page]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-slate-500">Every admin change is recorded here for accountability.</p>
      <div className="card overflow-x-auto">
        {list.loading ? <Spinner /> : (
          <table className="w-full min-w-[600px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">When</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Details</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.logs.map((l: any) => (
                <tr key={l.id}><td className="td text-slate-500">{dateTime(l.createdAt)}</td><td className="td"><span className="badge bg-slate-100 text-slate-700">{l.action}</span></td><td className="td">{l.entity} <span className="font-mono text-xs text-slate-400">{l.entityId?.slice(-6)}</span></td><td className="td font-mono text-xs text-slate-500">{l.meta}</td></tr>
              ))}
              {list.data.logs.length === 0 && <tr><td className="td text-center text-slate-400" colSpan={4}>No activity yet</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} pages={list.data?.logs.length === 25 ? page + 1 : page} onChange={setPage} />
    </div>
  );
}
