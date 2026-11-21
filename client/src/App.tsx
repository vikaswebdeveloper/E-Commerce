import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { RequireAuth, Spinner } from './components/ui';
import Home from './pages/Home';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Wishlist from './pages/Wishlist';
import { Forgot, Login, Reset, Signup } from './pages/AuthPages';
import { StaticPage, NotFound } from './pages/Static';

const Checkout = lazy(() => import('./pages/Checkout'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Account = lazy(() => import('./pages/Account'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts'));
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'));
const AdminCustomers = lazy(() => import('./pages/admin/AdminCustomers'));
const AdminCoupons = lazy(() => import('./pages/admin/AdminCoupons'));
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollTop />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="products" element={<Products />} />
            <Route path="products/:slug" element={<ProductDetail />} />
            <Route path="cart" element={<RequireAuth><Cart /></RequireAuth>} />
            <Route path="wishlist" element={<RequireAuth><Wishlist /></RequireAuth>} />
            <Route path="checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
            <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
            <Route path="orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
            <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="login" element={<Login />} />
            <Route path="signup" element={<Signup />} />
            <Route path="forgot-password" element={<Forgot />} />
            <Route path="reset-password" element={<Reset />} />
            {['about', 'contact', 'faq', 'shipping', 'returns', 'privacy', 'terms'].map((s) => (
              <Route key={s} path={s} element={<StaticPage slug={s} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="coupons" element={<AdminCoupons />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
