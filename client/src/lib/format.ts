/** Money is stored as integer paise on the server. */
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(paise / 100);

export const toPaise = (rupees: string | number) => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number) => String(paise / 100);

export const date = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const discountPct = (price: number, mrp: number) => (mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);

export const STATUS_STYLE: Record<string, string> = {
  PENDING_PAYMENT: 'bg-amber-100 text-amber-800',
  PAID: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-indigo-100 text-indigo-800',
  SHIPPED: 'bg-sky-100 text-sky-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  REFUNDED: 'bg-rose-100 text-rose-800',
};
export const statusLabel = (s: string) => s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
