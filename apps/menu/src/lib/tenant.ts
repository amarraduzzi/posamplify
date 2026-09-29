// Which restaurant and which table is this page for?
//   Production:  https://<slug>.<VITE_ROOT_DOMAIN>/t/<token>
//   Fallback:    https://<any-host>/<slug>/t/<token>   (pages.dev previews, local dev)
// The token can also come as ?t=<token>.
export interface Tenant { slug: string | null; tableToken: string | null }

export function resolveTenant(loc: Pick<Location, 'hostname' | 'pathname' | 'search'> = window.location,
                              rootDomain: string = import.meta.env.VITE_ROOT_DOMAIN ?? ''): Tenant {
  const parts = loc.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let slug: string | null = null;
  const root = rootDomain.replace(/^\./, '').toLowerCase();
  const host = loc.hostname.toLowerCase();
  if (root && host.endsWith('.' + root)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub && sub !== 'www' && !sub.includes('.')) slug = sub;
  }
  if (!slug && parts[0] && parts[0] !== 't') slug = parts.shift()!.toLowerCase();
  else if (slug && parts[0] && parts[0] !== 't') parts.shift();

  let tableToken: string | null = parts[0] === 't' && parts[1] ? parts[1] : null;
  const q = new URLSearchParams(loc.search).get('t');
  if (q) tableToken = q;
  if (slug && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) slug = null;
  if (tableToken && !/^[a-z0-9]{6,32}$/i.test(tableToken)) tableToken = null;
  return { slug, tableToken };
}
