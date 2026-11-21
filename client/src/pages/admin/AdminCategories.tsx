import { useState } from 'react';
import { ErrorBox, Spinner, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';

export default function AdminCategories() {
  const { toast } = useApp();
  const { data, loading, reload } = useAsync(() => api.get('/api/categories'), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api.post('/api/admin/categories', { name }); setName(''); toast('Category added'); reload(); } catch (e: any) { setErr(e.message); }
  };
  const save = async () => {
    if (!edit) return;
    try { await api.put(`/api/admin/categories/${edit.id}`, { name: edit.name }); setEdit(null); reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const del = async (id: string) => {
    if (!window.confirm('Delete this category?')) return;
    try { await api.del(`/api/admin/categories/${id}`); reload(); } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Categories</h1>
      <form onSubmit={add} className="flex gap-2"><input className="input" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} /><button className="btn-primary">Add</button></form>
      <ErrorBox msg={err} />
      <div className="card divide-y divide-slate-100">
        {loading ? <Spinner /> : data.categories.map((c: any) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            {edit && edit.id === c.id ? <input className="input" value={edit.name} onChange={(e) => setEdit({ id: edit.id, name: e.target.value })} /> : <div className="flex-1"><span className="font-medium">{c.name}</span> <span className="text-xs text-slate-400">· {c.productCount} products</span></div>}
            {edit?.id === c.id ? <><button className="btn-dark btn-sm" onClick={save}>Save</button><button className="btn-outline btn-sm" onClick={() => setEdit(null)}>Cancel</button></> : <><button className="btn-outline btn-sm" onClick={() => setEdit({ id: c.id, name: c.name })}>Rename</button><button className="btn-outline btn-sm text-red-600" onClick={() => del(c.id)}>Delete</button></>}
          </div>
        ))}
      </div>
    </div>
  );
}
