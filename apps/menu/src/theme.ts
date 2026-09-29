import { inkFor, isRtl, type Branding } from '@resto/shared';

// Display fonts a restaurant may pick. Allowlist, so branding data can never
// inject arbitrary stylesheets.
const DISPLAY_FONTS: Record<string, string> = {
  'Bodoni Moda': 'Bodoni+Moda:opsz,wght@6..96,500;6..96,700',
  'Playfair Display': 'Playfair+Display:wght@500;700',
  'Fraunces': 'Fraunces:opsz,wght@9..144,500;9..144,700',
  'Poppins': 'Poppins:wght@500;700',
  'DM Serif Display': 'DM+Serif+Display',
};

const HEX = /^#[0-9a-f]{6}$/i;

export function applyBranding(b: Branding, name: string) {
  const root = document.documentElement;
  const brand = b.primary_color && HEX.test(b.primary_color) ? b.primary_color : '#C2410C';
  root.style.setProperty('--brand', brand);
  root.style.setProperty('--brand-ink', inkFor(brand));
  root.dataset.theme = b.theme === 'dark' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', b.theme === 'dark' ? '#14100B' : '#FAF8F5');
  document.title = name;

  const font = b.font_display && DISPLAY_FONTS[b.font_display] ? b.font_display : null;
  if (font && !document.getElementById('display-font')) {
    const link = document.createElement('link');
    link.id = 'display-font';
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${DISPLAY_FONTS[font]}&display=swap`;
    document.head.appendChild(link);
  }
  root.style.setProperty('--font-display-family',
    font ? `"${font}", "Noto Naskh Arabic", serif` : '"Inter", "Noto Naskh Arabic", system-ui, sans-serif');

  if (b.logo_url) {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
    icon.href = b.logo_url;
  }
}

export function applyLang(lang: string) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = isRtl(lang) ? 'rtl' : 'ltr';
}
