import os from 'node:os';
import { createApp } from './app.js';
import { b2Enabled, config, mockPayments } from './config.js';
import { expireStaleOrders } from './services/orders.js';
import { prisma } from './db.js';
import { sweepOrphanImages } from './services/imageCleanup.js';

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on port ${config.port} (host ${config.host})`);
  console.log(`  local:   http://localhost:${config.port}`);
  if (config.host === '0.0.0.0' || config.host === '::') {
    for (const ip of lanAddresses()) console.log(`  network: http://${ip}:${config.port}`);
  }
  console.log(`  payments: ${mockPayments ? 'MOCK' : 'Razorpay'}   images: ${b2Enabled ? 'Backblaze B2' : 'local disk (dev only)'}`);
});

// Free reserved stock from abandoned, unpaid online orders.
const timer = setInterval(() => {
  expireStaleOrders(config.pendingOrderTtlMinutes).catch((e) => console.error('expire job failed', e));
}, 5 * 60_000);

// Safety net for images that no product references any more (e.g. an upload abandoned mid-way).
const sweep = () =>
  sweepOrphanImages()
    .then((r) => r.deleted && console.log(`[images] removed ${r.deleted} orphaned image(s)`))
    .catch((e) => console.error('image sweep failed', e));
const sweepStart = setTimeout(sweep, 60_000);
const sweepTimer = setInterval(sweep, 6 * 3600_000);

const shutdown = async () => {
  clearInterval(timer);
  clearInterval(sweepTimer);
  clearTimeout(sweepStart);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
