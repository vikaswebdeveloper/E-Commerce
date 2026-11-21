import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const catalog: Record<string, { brand: string; name: string; price: number; mrp: number }[]> = {
  Electronics: [
    { brand: 'Sonic', name: 'Wireless Noise-Cancelling Headphones', price: 4999, mrp: 7999 },
    { brand: 'Sonic', name: 'True Wireless Earbuds', price: 1999, mrp: 3499 },
    { brand: 'Pulse', name: 'Smart Watch Series 5', price: 6999, mrp: 9999 },
    { brand: 'Pulse', name: 'Fitness Band 3', price: 1499, mrp: 2499 },
    { brand: 'Volt', name: 'Portable Bluetooth Speaker', price: 2499, mrp: 3999 },
    { brand: 'Volt', name: '20000mAh Power Bank', price: 1799, mrp: 2599 },
  ],
  Fashion: [
    { brand: 'Urban Co', name: 'Classic Cotton T-Shirt', price: 599, mrp: 999 },
    { brand: 'Urban Co', name: 'Slim Fit Denim Jeans', price: 1799, mrp: 2999 },
    { brand: 'Stride', name: 'Everyday Running Shoes', price: 2999, mrp: 4999 },
    { brand: 'Stride', name: 'Leather Casual Sneakers', price: 3499, mrp: 5499 },
    { brand: 'Aura', name: 'Printed Summer Dress', price: 1299, mrp: 2199 },
    { brand: 'Aura', name: 'Hooded Sweatshirt', price: 1499, mrp: 2499 },
  ],
  'Home & Kitchen': [
    { brand: 'Hearth', name: 'Non-Stick Cookware Set (5 pc)', price: 2799, mrp: 4499 },
    { brand: 'Hearth', name: 'Stainless Steel Water Bottle', price: 499, mrp: 799 },
    { brand: 'Nest', name: 'Memory Foam Pillow', price: 899, mrp: 1499 },
    { brand: 'Nest', name: 'Cotton Bedsheet Set (Queen)', price: 1599, mrp: 2599 },
    { brand: 'Lumen', name: 'LED Desk Lamp', price: 999, mrp: 1599 },
    { brand: 'Lumen', name: 'Ceramic Dinner Set (16 pc)', price: 2199, mrp: 3499 },
  ],
  Books: [
    { brand: 'Penguin', name: 'The Art of Focus (Paperback)', price: 349, mrp: 499 },
    { brand: 'Penguin', name: 'Modern Economics Explained', price: 549, mrp: 799 },
    { brand: 'Harper', name: 'Stories from the Himalayas', price: 299, mrp: 450 },
    { brand: 'Harper', name: 'Cooking Made Simple', price: 699, mrp: 999 },
  ],
  Beauty: [
    { brand: 'Glow', name: 'Vitamin C Face Serum', price: 599, mrp: 999 },
    { brand: 'Glow', name: 'Daily Moisturiser SPF 30', price: 449, mrp: 699 },
    { brand: 'Pure', name: 'Herbal Shampoo 500ml', price: 349, mrp: 549 },
    { brand: 'Pure', name: 'Beard Grooming Kit', price: 899, mrp: 1499 },
  ],
  Sports: [
    { brand: 'Fit', name: 'Yoga Mat 6mm', price: 799, mrp: 1299 },
    { brand: 'Fit', name: 'Adjustable Dumbbell Set', price: 3499, mrp: 5499 },
    { brand: 'Peak', name: 'Trekking Backpack 45L', price: 2399, mrp: 3799 },
    { brand: 'Peak', name: 'Insulated Sports Bottle', price: 649, mrp: 999 },
  ],
};

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@shop.test').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
  const hash = (p: string) => bcrypt.hash(p, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { name: 'Store Admin', email: adminEmail, passwordHash: await hash(adminPassword), role: 'ADMIN' },
  });
  await prisma.user.upsert({
    where: { email: 'customer@shop.test' },
    update: {},
    create: { name: 'Demo Customer', email: 'customer@shop.test', passwordHash: await hash('Customer@12345'), role: 'CUSTOMER' },
  });

  let n = 0;
  for (const [catName, products] of Object.entries(catalog)) {
    const category = await prisma.category.upsert({
      where: { slug: slugify(catName) },
      update: {},
      create: { name: catName, slug: slugify(catName) },
    });
    for (const p of products) {
      const slug = slugify(p.name);
      n++;
      await prisma.product.upsert({
        where: { slug },
        update: {},
        create: {
          name: p.name,
          slug,
          brand: p.brand,
          description: `${p.name} by ${p.brand}. Thoughtfully designed, built to last and backed by a 1-year warranty. Easy returns within 7 days of delivery.`,
          price: p.price * 100,
          mrp: p.mrp * 100,
          stock: 10 + ((n * 7) % 40),
          images: JSON.stringify([`https://picsum.photos/seed/${slug}/800/800`, `https://picsum.photos/seed/${slug}-2/800/800`]),
          categoryId: category.id,
          isFeatured: n % 5 === 0,
          soldCount: (n * 13) % 90,
        },
      });
    }
  }

  await prisma.coupon.upsert({ where: { code: 'WELCOME10' }, update: {}, create: { code: 'WELCOME10', type: 'PERCENT', value: 10, minOrder: 50000, maxDiscount: 50000 } });
  await prisma.coupon.upsert({ where: { code: 'FLAT200' }, update: {}, create: { code: 'FLAT200', type: 'FLAT', value: 20000, minOrder: 200000 } });

  console.log(`Seeded. Admin: ${adminEmail} / ${adminPassword}   Customer: customer@shop.test / Customer@12345`);
}

main().finally(() => prisma.$disconnect());
