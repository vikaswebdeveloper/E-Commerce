import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on 0.0.0.0 so other devices on the network can open http://<your-ip>:5173
    // Same-origin for the browser, so the httpOnly auth cookie works from any device.
    proxy: { '/api': api, '/uploads': api },
  },
  preview: { port: 5173, host: true, proxy: { '/api': api, '/uploads': api } },
});
