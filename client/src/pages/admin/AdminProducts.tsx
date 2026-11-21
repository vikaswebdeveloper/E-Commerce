import { useRef, useState } from 'react';
import { ErrorBox, Img, Modal, Pagination, Spinner, useAsync } from '../../components/ui';
import { useApp } from '../../context/app';
import { api } from '../../lib/api';
import { money, toPaise, toRupees } from '../../lib/format';

const blank = { name: '', description: '', price: '', mrp: '', stock: '0', brand: '', categoryId: '', images: [] as string[], isActive: true, isFeatured: false };

export default function AdminProducts() {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const cats = useAsync(() => api.get('/api/categories'), []);
  const list = useAsync(() => api.get('/api/admin/products', { page, q, status }), [page, q, status]);

  const del = async (p: any) => {
    if (!window.confirm(`Delete "${p.name}"? Products with past orders are archived instead.`)) return;
    try { const r = await api.del(`/api/admin/products/${p.id}`); toast(r.archived ? 'Product archived (has order history)' : 'Product deleted'); list.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Products</h1>
        <button className="btn-primary" onClick={() => setEditing({ ...blank, categoryId: cats.data?.categories[0]?.id ?? '' })}>+ New product</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input !w-64" placeholder="Search name or brand…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input !w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="low">Low stock (≤5)</option>
        </select>
      </div>
      <div className="card overflow-x-auto">
        {list.loading ? <Spinner /> : (
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Product</th><th className="th">Category</th><th className="th">Price</th><th className="th">Stock</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.items.map((p: any) => (
                <tr key={p.id}>
                  <td className="td"><div className="flex items-center gap-3"><Img src={p.images[0]} alt="" className="h-10 w-10 rounded object-cover bg-slate-100" /><div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-400">{p.brand}</div></div></div></td>
                  <td className="td">{p.category?.name}</td>
                  <td className="td">{money(p.price)} <span className="text-xs text-slate-400 line-through">{money(p.mrp)}</span></td>
                  <td className={`td font-medium ${p.stock <= 5 ? 'text-amber-600' : ''}`}>{p.stock}</td>
                  <td className="td"><span className={`badge ${p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{p.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="td whitespace-nowrap text-right"><button className="btn-outline btn-sm mr-2" onClick={() => setEditing({ ...p, price: toRupees(p.price), mrp: toRupees(p.mrp), stock: String(p.stock), brand: p.brand ?? '' })}>Edit</button><button className="btn-outline btn-sm text-red-600" onClick={() => del(p)}>Delete</button></td>
                </tr>
              ))}
              {list.data.items.length === 0 && <tr><td className="td text-center text-slate-400" colSpan={6}>No products found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {list.data && <Pagination page={page} pages={list.data.pages} onChange={setPage} />}
      {editing && <ProductForm initial={editing} cats={cats.data?.categories ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function ProductForm({ initial, cats, onClose, onSaved }: { initial: any; cats: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fresh = useRef<Set<string>>(new Set());
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  const upload = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api.upload('/api/admin/upload', fd);
      fresh.current.add(r.url);
      setF((prev: any) => ({ ...prev, images: [...prev.images, r.url] }));
    } catch (e: any) { setErr(e.message); }
  };

  // Images uploaded in this form but never saved are deleted from storage straight away.
  const discard = (urls: string[]) => urls.forEach((u) => api.post('/api/admin/upload/discard', { url: u }).catch(() => undefined));
  const removeImage = (src: string) => {
    set('images', f.images.filter((x: string) => x !== src));
    if (fresh.current.has(src)) { fresh.current.delete(src); discard([src]); }
  };
  const close = () => { discard(f.images.filter((u: string) => fresh.current.has(u))); onClose(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = { name: f.name, description: f.description, price: toPaise(f.price), mrp: toPaise(f.mrp || f.price), stock: Number(f.stock), brand: f.brand || undefined, categoryId: f.categoryId, images: f.images, isActive: f.isActive, isFeatured: f.isFeatured };
    try {
      if (f.id) await api.put(`/api/admin/products/${f.id}`, body); else await api.post('/api/admin/products', body);
      toast(f.id ? 'Product updated' : 'Product created');
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Edit product' : 'New product'} onClose={close} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Name</label><input className="input" required minLength={2} maxLength={150} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Description</label><textarea className="input" rows={3} required maxLength={5000} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div><label className="label">Selling price (₹)</label><input className="input" type="number" min="0.01" step="0.01" required value={f.price} onChange={(e) => set('price', e.target.value)} /></div>
        <div><label className="label">MRP (₹)</label><input className="input" type="number" min="0.01" step="0.01" value={f.mrp} onChange={(e) => set('mrp', e.target.value)} placeholder="Same as price" /></div>
        <div><label className="label">Stock</label><input className="input" type="number" min="0" step="1" required value={f.stock} onChange={(e) => set('stock', e.target.value)} /></div>
        <div><label className="label">Brand</label><input className="input" maxLength={60} value={f.brand} onChange={(e) => set('brand', e.target.value)} /></div>
        <div><label className="label">Category</label><select className="input" required value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="" disabled>Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="flex items-end gap-5 pb-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /> Featured</label>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Images</label>
          <div className="mb-2 flex flex-wrap gap-2">
            {f.images.map((src: string) => (
              <div key={src} className="relative"><Img src={src} alt="" className="h-16 w-16 rounded border object-cover" /><button type="button" aria-label="Remove image" className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-xs text-white" onClick={() => removeImage(src)}>×</button></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="flex flex-1 gap-2"><input className="input" placeholder="…or paste image URL (https://)" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} /><button type="button" className="btn-outline" disabled={!/^https?:\/\//i.test(urlInput)} onClick={() => { set('images', [...f.images, urlInput]); setUrlInput(''); }}>Add</button></div>
          </div>
        </div>
        <div className="sm:col-span-2"><ErrorBox msg={err} /></div>
        <div className="flex gap-2 sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button><button type="button" className="btn-outline" onClick={close}>Cancel</button></div>
      </form>
    </Modal>
  );
}
