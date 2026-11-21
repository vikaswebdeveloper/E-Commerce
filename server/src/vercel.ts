import { createApp } from './app.js';

/**
 * Vercel entry point. The Express app is exported as the request handler; there is no app.listen() and no
 * setInterval here, because serverless functions are short-lived (housekeeping runs via /api/cron/maintenance
 * and lazily on checkout instead).
 *
 * This file is bundled by scripts/build-api.mjs into api/index.mjs, which is what Vercel actually runs.
 */
export default createApp();
