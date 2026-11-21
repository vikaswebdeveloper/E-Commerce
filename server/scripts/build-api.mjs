// Bundles the API into ONE plain JavaScript file for Vercel (api/index.mjs).
// Why: it removes any dependence on how a host compiles TypeScript / resolves ".js" imports of ".ts" files.
// Everything is inlined except the Prisma client, which ships a native query engine that must stay in node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/vercel.ts'],
  outfile: 'api/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['@prisma/client', '.prisma/client', '.prisma/client/*'],
  // Some bundled CommonJS dependencies call require(); give the ESM bundle a working one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
});
