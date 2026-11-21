/** @type {import('tailwindcss').Config} */
// The slate scale and "surface" are CSS variables (see index.css) so dark mode flips the whole palette in one place.
const slate = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `rgb(var(--slate-${n}) / <alpha-value>)`]),
);

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        slate,
        surface: 'rgb(var(--surface) / <alpha-value>)',
        // Always-dark shades for surfaces that stay dark in both themes (hero banner, admin sidebar).
        ink: { 300: '#cbd5e1', 400: '#94a3b8', 800: '#1e293b', 900: '#0f172a' },
        brand: { 50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
      },
    },
  },
  plugins: [],
};
