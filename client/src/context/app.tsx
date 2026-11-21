import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

export type User = { id: string; name: string; email: string; role: 'CUSTOMER' | 'ADMIN' };
export type CartItem = {
  id: string; productId: string; quantity: number; available: boolean;
  product: { id: string; name: string; slug: string; price: number; mrp: number; stock: number; images: string[] };
};
export type Cart = { items: CartItem[]; subtotal: number; count: number };
type Toast = { id: number; msg: string; type: 'ok' | 'err' };

type Ctx = {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  cart: Cart;
  refreshCart: () => Promise<void>;
  setCart: (c: Cart) => void;
  wishlist: Set<string>;
  toggleWish: (productId: string) => Promise<boolean>;
  toast: (msg: string, type?: 'ok' | 'err') => void;
};

const empty: Cart = { items: [], subtotal: 0, count: 0 };
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Cart>(empty);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      setCart(await api.get('/api/cart'));
    } catch {
      setCart(empty);
    }
  }, []);

  useEffect(() => {
    api.get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setCart(empty);
      setWishlist(new Set());
      return;
    }
    refreshCart();
    api.get('/api/wishlist').then((r) => setWishlist(new Set(r.items.map((i: any) => i.product.id)))).catch(() => undefined);
  }, [user, refreshCart]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  const toggleWish = useCallback(
    async (productId: string) => {
      if (!user) return false;
      const has = wishlist.has(productId);
      try {
        if (has) await api.del(`/api/wishlist/${productId}`);
        else await api.post(`/api/wishlist/${productId}`);
        setWishlist((w) => {
          const n = new Set(w);
          has ? n.delete(productId) : n.add(productId);
          return n;
        });
        toast(has ? 'Removed from wishlist' : 'Added to wishlist');
      } catch (e: any) {
        toast(e.message, 'err');
      }
      return true;
    },
    [user, wishlist, toast],
  );

  const value = useMemo(
    () => ({ user, loading, setUser, logout, cart, refreshCart, setCart, wishlist, toggleWish, toast }),
    [user, loading, logout, cart, refreshCart, wishlist, toggleWish, toast],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${t.type === 'ok' ? 'bg-slate-900 text-slate-50' : 'bg-red-600 text-white'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
