import { useState } from 'react';
import { ErrorBox, Spinner, useAsync } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';

export function AddressForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (a: any) => void; onCancel: () => void }) {
  const [f, setF] = useState({ fullName: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', isDefault: false, ...initial });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = { fullName: f.fullName, phone: f.phone, line1: f.line1, line2: f.line2 || undefined, city: f.city, state: f.state, pincode: f.pincode, isDefault: f.isDefault };
    try {
      const r = initial?.id ? await api.put(`/api/addresses/${initial.id}`, body) : await api.post('/api/addresses', body);
      onSaved(r.address);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div><label className="label">Full name</label><input className="input" required value={f.fullName} onChange={set('fullName')} maxLength={80} /></div>
      <div><label className="label">Mobile number</label><input className="input" required inputMode="numeric" pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" value={f.phone} onChange={set('phone')} maxLength={10} /></div>
      <div className="sm:col-span-2"><label className="label">Address line 1</label><input className="input" required value={f.line1} onChange={set('line1')} maxLength={150} /></div>
      <div className="sm:col-span-2"><label className="label">Address line 2 (optional)</label><input className="input" value={f.line2 ?? ''} onChange={set('line2')} maxLength={150} /></div>
      <div><label className="label">City</label><input className="input" required value={f.city} onChange={set('city')} maxLength={60} /></div>
      <div><label className="label">State</label><input className="input" required value={f.state} onChange={set('state')} maxLength={60} /></div>
      <div><label className="label">Pincode</label><input className="input" required inputMode="numeric" pattern="[1-9][0-9]{5}" title="6-digit pincode" value={f.pincode} onChange={set('pincode')} maxLength={6} /></div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.isDefault} onChange={set('isDefault')} /> Make default</label>
      <div className="sm:col-span-2"><ErrorBox msg={err} /></div>
      <div className="flex gap-2 sm:col-span-2"><button className="btn-primary" disabled={busy}>Save address</button><button type="button" className="btn-outline" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function Account() {
  const { user, setUser, toast } = useApp();
  const addrs = useAsync(() => api.get('/api/addresses'), []);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwErr, setPwErr] = useState('');
  const [nameErr, setNameErr] = useState('');

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault(); setNameErr('');
    try { const r = await api.patch('/api/auth/me', { name }); setUser(r.user); toast('Profile updated'); } catch (e: any) { setNameErr(e.message); }
  };
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault(); setPwErr('');
    try { await api.post('/api/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); toast('Password changed'); } catch (e: any) { setPwErr(e.message); }
  };
  const remove = async (id: string) => { if (window.confirm('Delete this address?')) { await api.del(`/api/addresses/${id}`); addrs.reload(); } };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">My account</h1>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Profile</h2>
        <form onSubmit={saveName} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} /></div>
          <div><label className="label">Email</label><input className="input" value={user?.email} disabled /></div>
          <button className="btn-dark">Save</button>
        </form>
        <div className="mt-2"><ErrorBox msg={nameErr} /></div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Saved addresses</h2>{!editing && <button className="text-sm font-medium text-brand-600" onClick={() => setEditing('new')}>+ Add address</button>}</div>
        {editing ? (
          <AddressForm initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); addrs.reload(); }} />
        ) : addrs.loading ? <Spinner /> : addrs.data.addresses.length === 0 ? <p className="text-sm text-slate-500">No addresses saved.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {addrs.data.addresses.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between"><b>{a.fullName}</b>{a.isDefault && <span className="badge bg-brand-50 text-brand-700">Default</span>}</div>
                <div className="mt-1 text-slate-600">{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.state} – {a.pincode}<br />{a.phone}</div>
                <div className="mt-2 flex gap-3 text-xs"><button className="text-brand-600" onClick={() => setEditing(a)}>Edit</button><button className="text-red-600" onClick={() => remove(a.id)}>Delete</button></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Change password</h2>
        <form onSubmit={changePw} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div><label className="label">Current password</label><input type="password" autoComplete="current-password" className="input" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div><label className="label">New password</label><input type="password" autoComplete="new-password" className="input" required maxLength={72} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
          <button className="btn-dark">Update</button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Changing your password signs you out of all other devices.</p>
        <div className="mt-2"><ErrorBox msg={pwErr} /></div>
      </section>
    </div>
  );
}
