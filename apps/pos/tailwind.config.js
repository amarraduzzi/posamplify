/** @type {import('tailwindcss').Config} */
const v = name => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: v('brand'), 'brand-hi': v('brand-hi'), 'brand-ink': v('brand-ink'),
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), 'surface-3': v('surface-3'),
        ink: v('ink'), muted: v('muted'), line: v('line'),
        ok: v('ok'), warn: v('warn'), danger: v('danger'), qr: v('qr'),
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"IBM Plex Sans Arabic"', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['"Montserrat Variable"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        logo: ['"Montserrat Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
