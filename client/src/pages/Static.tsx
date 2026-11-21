import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/app';

const P = ({ children }: { children: React.ReactNode }) => <p className="leading-relaxed text-slate-600">{children}</p>;

const PAGES: Record<string, { title: string; body: React.ReactNode }> = {
  about: {
    title: 'About us',
    body: <><P>Shop started with a simple idea: buying online should be effortless, honest and reliable. We work directly with trusted brands so you get genuine products at fair prices.</P><P>Our team handles every order with care — from quality checks to doorstep delivery — and our support team is always a message away.</P></>,
  },
  contact: { title: 'Contact us', body: <ContactForm /> },
  faq: {
    title: 'Frequently asked questions',
    body: (
      <div className="space-y-5">
        {[
          ['How do I track my order?', 'Open "My orders" from your account menu to see live status for every order.'],
          ['Which payment methods do you accept?', 'UPI, cards, net banking and wallets via Razorpay, plus Cash on Delivery on eligible orders.'],
          ['Can I cancel an order?', 'Yes — until it is shipped. Prepaid orders are refunded to the original payment method.'],
          ['How long do refunds take?', 'Refunds are initiated immediately and reach your account in 5–7 business days.'],
        ].map(([q, a]) => <div key={q}><h3 className="font-semibold">{q}</h3><P>{a}</P></div>)}
      </div>
    ),
  },
  shipping: { title: 'Shipping & delivery', body: <><P>Orders are dispatched within 24 hours and typically arrive in 3–7 business days.</P><P>Delivery is free on orders of ₹999 and above; otherwise a flat ₹49 fee applies.</P></> },
  returns: { title: 'Returns & refunds', body: <><P>Not happy? Return any unused item within 7 days of delivery for a full refund.</P><P>Prepaid orders are refunded to the original payment method; Cash on Delivery refunds are sent by bank transfer.</P></> },
  privacy: { title: 'Privacy policy', body: <><P>We collect only the information needed to process your orders: your name, contact details, delivery address and order history.</P><P>Payments are processed by Razorpay; we never see or store your card details. We never sell your personal data.</P><P>You can request deletion of your account at any time by contacting support.</P></> },
  terms: { title: 'Terms of service', body: <><P>By using this site you agree to our policies on orders, payments, returns and acceptable use.</P><P>Prices and availability may change without notice. We reserve the right to cancel orders affected by pricing errors, with a full refund.</P></> },
};

function ContactForm() {
  const { toast } = useApp();
  const [sent, setSent] = useState(false);
  return sent ? <P>Thanks! We'll get back to you within one business day.</P> : (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setSent(true); toast('Message sent'); }}>
      <P>Questions about an order or product? Send us a note.</P>
      <div><label className="label" htmlFor="cn">Name</label><input id="cn" className="input" required maxLength={80} /></div>
      <div><label className="label" htmlFor="ce">Email</label><input id="ce" type="email" className="input" required /></div>
      <div><label className="label" htmlFor="cm">Message</label><textarea id="cm" className="input" rows={4} required maxLength={1000} /></div>
      <button className="btn-primary">Send message</button>
    </form>
  );
}

export function StaticPage({ slug }: { slug: string }) {
  const p = PAGES[slug];
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-3xl font-bold">{p.title}</h1>
      <div className="space-y-4">{p.body}</div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="py-20 text-center">
      <div className="text-6xl font-bold text-slate-300">404</div>
      <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
      <p className="mt-1 text-slate-500">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn-primary mt-6">Back to home</Link>
    </div>
  );
}
