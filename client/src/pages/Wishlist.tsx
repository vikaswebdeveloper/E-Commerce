import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { Empty, Spinner, useAsync } from '../components/ui';
import { useApp } from '../context/app';
import { api } from '../lib/api';

export default function Wishlist() {
  const { wishlist } = useApp();
  const { data, loading } = useAsync(() => api.get('/api/wishlist'), []);
  if (loading) return <Spinner />;
  // Reflect removals made via the heart button without refetching.
  const items = (data?.items ?? []).filter((i: any) => wishlist.has(i.product.id));
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">My wishlist</h1>
      {items.length === 0 ? (
        <Empty title="Your wishlist is empty" hint="Tap the heart on any product to save it for later." action={<Link to="/products" className="btn-primary">Browse products</Link>} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map((i: any) => <ProductCard key={i.id} p={i.product} />)}</div>
      )}
    </div>
  );
}
