# Shop — E-commerce platform

Full-stack store with a **customer storefront** and an **admin panel**, Razorpay payments, and a security-focused test suite.

**Stack:** Node.js + Express 5 · TypeScript · Prisma + **Neon (PostgreSQL)** · **Backblaze B2** image storage · React 18 + Vite · Tailwind CSS · Vitest + Supertest

## Quick start

```bash
npm run install:all                      # install server + client deps
copy server\.env.example server\.env     # (macOS/Linux: cp)  then fill in the values below
npm run setup                            # generate Prisma client, create tables in Neon, seed demo data
npm run dev:server                       # API  -> port 4000, listening on your network
npm run dev:client                       # Web  -> port 5173, listening on your network
```

### 1. Neon (PostgreSQL)

In the Neon console, copy two connection strings into `server/.env` (turn **Connection pooling off** to get the direct string, whose host has no `-pooler`):

| Variable | Which string | Used for |
|---|---|---|
| `DATABASE_URL` | Your real database | the running app, `prisma db push`, seeding |
| `TEST_DATABASE_URL` | A **separate** branch/database whose name contains `test` (e.g. `shop_test`) | the test suite (it wipes this DB) |

Direct connections are fine for this app's size. If you later need many concurrent connections, switch `DATABASE_URL` to Neon's pooled string (add `&pgbouncer=true`) and re-add a `directUrl` for schema changes.

`npm run setup` creates the tables and seeds demo data. Use `npm --prefix server run db:push` after schema changes.

### 2. Backblaze B2 (product images)

1. Create a **public** bucket.
2. Create an **Application Key** restricted to that bucket (read + write).
3. Fill in `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, and `B2_REGION` (the part of the endpoint like `us-west-004`).
4. Optional: `B2_PUBLIC_URL` if you put a CDN / custom domain in front of the bucket.

Admin image uploads go to `products/<random-uuid>.<ext>` in the bucket (type is verified from the file's magic bytes; JPG / PNG / WEBP, max 2 MB). Without B2 configured, development falls back to local disk (`server/uploads/`); **production refuses to start without B2**. The Application Key needs list / read / write / **delete** file permissions.

**Images are kept in sync with the catalog — removed images are deleted, not orphaned:**

| Event | Result |
|---|---|
| Image removed or replaced when editing a product | Deleted from B2 on save |
| Product deleted | All its images deleted |
| Image uploaded in the product form, then the form is cancelled / the image removed before saving | Deleted immediately |
| Browser closed mid-upload, or any other leftover | A sweep (on startup +1 min, then every 6 h) removes images no product references (older than 1 h) |
| Product archived (it has order history) | Images kept (the product still exists) |
| Image still used by another product | Never deleted |
| External URLs (e.g. the `picsum.photos` seed images) | Never touched |

Backblaze keeps every *version* of a file by default, so a plain delete would only hide it and you'd keep paying for it. The server therefore deletes **all versions** of the file. Deleted images are also cleared from old order snapshots, so order history shows a neutral placeholder instead of a broken link. The sweep refuses to run if the products table is empty, so pointing the app at the wrong database can never wipe the bucket. As an extra safety net you can set the bucket's lifecycle rule to *"Keep only the last version of the file"*.

### 3. Running on your network

Both servers listen on all interfaces (`HOST=0.0.0.0`; Vite uses `host: true`). On startup the API prints its network address, and Vite prints a **Network:** URL. Open that URL (e.g. `http://192.168.1.11:5173`) from any device on the same network.

- The browser talks to Vite, which proxies `/api` to the API, so cookies work from every device.
- In development the API automatically accepts browser origins from private LAN addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`). Disable with `ALLOW_LAN_ORIGINS=0`.
- **Windows Firewall** may prompt the first time; allow Node.js on *Private* networks (or open TCP 4000 and 5173).
- To keep it on this machine only, set `HOST=127.0.0.1` and run the client with `npm --prefix client run dev -- --host 127.0.0.1`.
- Anyone on your network can reach the site, so **set a strong `ADMIN_PASSWORD` in `.env` before running the seed**, and don't use the demo customer account on a shared network.
- Razorpay Checkout over plain `http://` LAN addresses is fine for test keys; live payments need HTTPS on a real domain.

Demo accounts (from the seed; the admin uses your `ADMIN_EMAIL` / `ADMIN_PASSWORD`):

| Role     | Email                | Password         |
|----------|----------------------|------------------|
| Admin    | admin@shop.test      | Admin@12345      |
| Customer | customer@shop.test   | Customer@12345   |

Coupons seeded: `WELCOME10` (10% up to ₹500, min ₹500) and `FLAT200` (₹200 off over ₹2,000).

## Features

**Customer** — signup / login / logout, forgot & reset password, browse, live search suggestions, filters (category, brand, price, rating, in-stock), sorting, pagination, product detail with image gallery, star ratings & reviews (with verified-purchase badge), wishlist, cart with stock checks, saved addresses, coupons, checkout (Razorpay or Cash on Delivery), order history and tracking, cancel / refund, profile & password change, static pages (About, Contact, FAQ, Shipping, Returns, Privacy, Terms).

**Admin** — dashboard (revenue, orders, 7-day chart, status breakdown, low-stock alerts), product CRUD with image upload and archive-on-delete, category management, order management with a validated status flow and cancel / refund, customer list with suspend / reactivate, coupon & discount management (percent / flat, minimum, cap, usage limit, expiry), review moderation, audit log of every admin action.

## Razorpay

Set in `server/.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

Flow: the server creates the order and the Razorpay order for the **server-computed** amount → the browser opens Razorpay Checkout → the browser posts the result to `/api/payments/verify`, where the HMAC-SHA256 signature is verified → order becomes `PAID`. A webhook (`POST /api/payments/webhook`, events `payment.captured` / `order.paid`) is a second, independent confirmation path. Webhooks need a publicly reachable HTTPS URL (Razorpay's servers cannot reach a LAN address).

**Without keys** the server runs in **MOCK mode** (development / tests only). It is impossible in production: the server refuses to start in `NODE_ENV=production` without real keys, and the mock endpoint is not registered.

## Tests

```bash
npm test      # server + client
```

The server tests run against **PostgreSQL** using `TEST_DATABASE_URL`. The run executes `prisma db push --force-reset`, which **drops every table**, so a guard (`server/tests/safety.ts`) refuses to run unless the database name contains `test` and it differs from `DATABASE_URL`.

Coverage: authentication (hashing, lockout, enumeration, JWT forgery / `alg:none` / expiry, session invalidation), authorization (every admin route as anonymous and customer, IDOR on orders / addresses / reviews / cart), pricing integrity, stock integrity (concurrent oversell race, rollback, double-cancel), coupons, payments (forged / replayed / cross-order signatures, webhook signature and amount checks, idempotency), injection (SQLi, NoSQL-style objects, parameter pollution), stored XSS, file-upload spoofing and traversal, B2 storage (mocked), LAN-origin allow-list, CSRF origin checks, security headers, request-size limits, rate limiting and the order-value ceiling.

## Security measures

- Passwords: bcrypt (12 rounds), strong-password policy, 5-failure lockout, timing-equalised login, generic errors.
- Sessions: JWT in an **httpOnly, SameSite=Lax, Secure (prod)** cookie; token versioning invalidates sessions on password change / suspension.
- Role-based access on every admin route; ownership enforced in queries (IDOR-safe).
- Zod validation everywhere; HTML stripped from user text; image URLs restricted to http(s) or `/uploads/*`.
- Prisma parameterised queries (no raw SQL); simple query-string parser (no object injection).
- Helmet, strict CORS (+ private-LAN origins in development only), Origin check on state-changing requests, rate limits, 100 KB JSON limit.
- Uploads: magic-byte sniffing, random server-generated keys, 2 MB cap; B2 credentials never leave the server.
- Money in integer paise; totals recomputed on the server; atomic conditional stock decrement; atomic coupon usage; order value capped at ₹5,00,000.
- Unpaid online orders auto-expire after 30 min and release stock. Audit log for admin actions.

## Production checklist

1. `NODE_ENV=production` (Vercel sets it), a new random `JWT_SECRET` (≥ 32 chars), live Razorpay keys + webhook secret, `CLIENT_ORIGIN` set to your domain, `TRUST_PROXY=1`, `ALLOW_LAN_ORIGINS` unset.
2. **Email:** set `RESEND_API_KEY`, `MAIL_FROM` (verified domain) and `SUPPORT_EMAIL`. Without them password-reset emails are never delivered.
3. **Shared rate limits:** set `UPSTASH_REDIS_REST_URL` / `_TOKEN` (free tier is enough) on serverless hosts.
4. **Images:** configure Backblaze B2 (uploads return 503 without it) and put a CDN / custom domain in front (`B2_PUBLIC_URL`).
5. **Database:** a paid Neon plan with backups / point-in-time restore; keep tests on a separate branch.
6. **Accounts:** a strong `ADMIN_PASSWORD` (the seed refuses weak ones in production) and no demo customer.
7. **Hosting plan:** Vercel's free Hobby plan is non-commercial only; use Vercel Pro (or another paid host) for a real store.
8. Replace the placeholder legal pages (Privacy, Terms, Returns, Shipping) with your real policies.
9. Run `npm audit` regularly (CI also does it). Not built yet: admin two-factor login, courier / shipping-rate integration, GST invoices.

## Deploying to Vercel (free, for demos)

The repo is ready for a single Vercel project with **Root Directory = `server`**. `server/vercel.json` builds the website (`client/`), serves it as static files, and runs the API as one serverless function (`server/api/index.mjs`, a pre-bundled copy of the Express app, rebuilt on every deploy with `npm run build:api`). The site and API share one domain, so the login cookie just works.

1. Load the data once from your PC: put the **direct** Neon string in `server/.env`, a strong `ADMIN_PASSWORD`, then `npm run setup`.
2. Push to GitHub, then on vercel.com: **Add New → Project →** import the repo → set **Root Directory** to `server` (keep "Include source files outside of the Root Directory" on).
3. Add environment variables (Settings → Environment Variables):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string, add `&pgbouncer=true` |
| `JWT_SECRET` | new random 48+ chars |
| `TRUST_PROXY` | `1` |
| `CLIENT_ORIGIN` | `https://<your-project>.vercel.app` (set after the first deploy, then redeploy) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay **test** keys (production mode refuses mock payments) |
| `CRON_SECRET` | random string (enables the daily cleanup job) |
| `RESEND_API_KEY`, `MAIL_FROM`, `SUPPORT_EMAIL` | optional for a demo |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | optional for a demo, recommended for production |
| `B2_*` | optional for a demo (admin uploads are disabled without them) |

4. Razorpay dashboard → Webhooks: `https://<your-project>.vercel.app/api/payments/webhook`, events `payment.captured` + `order.paid`, secret = `RAZORPAY_WEBHOOK_SECRET`.
5. Test with Razorpay test card `4111 1111 1111 1111` (any future expiry / CVV) or UPI `success@razorpay`.

Notes: the daily cron (Hobby limit) frees stock from unpaid orders; stale orders are also cleaned during checkout. The website is served with a strict Content-Security-Policy (`server/vercel.json`): if you edit the inline theme script in `client/index.html`, update its hash there (a client test tells you).

## Project layout

```
server/   Express API  (src/routes, src/services, src/middleware, prisma/schema.prisma, tests/)
client/   React SPA    (src/pages, src/pages/admin, src/components, src/context)
```
