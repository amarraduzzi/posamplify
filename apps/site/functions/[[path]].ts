// Restaurant websites (own Cloudflare Pages project, root directory apps/site).
// * <this project>/<slug>[/menu]           -> the website of that restaurant (preview / no own domain)
// * a restaurant's own domain (added here) -> its website: /, /menu, /sitemap.xml, /robots.txt
import { renderSite, renderSitemap, type SiteData } from '../render';

interface Env { VITE_SUPABASE_URL: string; VITE_SUPABASE_ANON_KEY: string; VITE_MENU_URL?: string }
type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

const OWN = /(^|\.)amplifygrowthstudio\.com$|\.pages\.dev$|^localhost$|^127\.0\.0\.1$/;
const text = (s: string, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

async function getSite(env: Env, slug: string | null, host: string | null): Promise<SiteData | null> {
  const key = env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/get_site`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ p_slug: slug, p_host: host }),
  });
  if (!res.ok) throw new Error(`get_site ${res.status}`);
  return (await res.json()) as SiteData | null;
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const url = new URL(ctx.request.url);
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') return text('Méthode non autorisée', 405);
  const own = OWN.test(url.hostname);
  let slug: string | null = null, base = '', rest = url.pathname;
  if (own) {
    if (url.pathname === '/' ) return Response.redirect('https://www.amplifygrowthstudio.com/', 302);
    if (url.pathname === '/robots.txt') return text('User-agent: *\nAllow: /\n');
    const m = url.pathname.match(/^\/([a-z0-9-]{2,40})(\/.*)?$/);
    if (!m) return text('Site introuvable.', 404);
    slug = m[1]; base = `/${slug}`; rest = m[2] ?? '/';
  }
  const page = rest === '/' || rest === '' ? 'home' : rest === '/menu' || rest === '/menu/' ? 'menu'
    : rest === '/sitemap.xml' ? 'sitemap' : rest === '/robots.txt' ? 'robots' : null;
  if (!page) return Response.redirect(`${url.origin}${base || '/'}`, 302);

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const hit = cache ? await cache.match(ctx.request) : undefined;
  if (hit) return hit;

  let data: SiteData | null;
  try { data = await getSite(ctx.env, slug, own ? null : url.hostname); }
  catch { return new Response('Service momentanément indisponible.', { status: 503, headers: { 'retry-after': '30' } }); }
  if (!data) return text('Site introuvable.', 404);

  const origin = own ? url.origin : `https://${data.domain ?? url.hostname}`;
  const c = { base, origin, lang: url.searchParams.get('lang') ?? '', menuUrl: (ctx.env.VITE_MENU_URL || 'https://menu.amplifygrowthstudio.com').replace(/\/$/, '') };
  let body: string, type = 'text/html; charset=utf-8';
  if (page === 'sitemap') { body = renderSitemap(data, c); type = 'application/xml; charset=utf-8'; }
  else if (page === 'robots') { body = `User-agent: *\n${data.noindex ? 'Disallow: /' : 'Allow: /'}\nSitemap: ${origin}${base}/sitemap.xml\n`; type = 'text/plain; charset=utf-8'; }
  else body = renderSite(data, c, page);
  const res = new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=300', 'x-robots-tag': data.noindex ? 'noindex' : 'all', 'x-content-type-options': 'nosniff' } });
  if (cache) ctx.waitUntil(cache.put(ctx.request, res.clone()));
  return res;
};
