import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ShoppingBag, MapPin, Utensils, Eye, ChevronRight } from 'lucide-react';
import { errorCode, formatMoney, newId, tr, type OrderType, type PublicItem, type PublicMenu } from '@resto/shared';
import { getMenu, getOrderStatus, placeOrder, ApiError } from './lib/api';
import { resolveTenant } from './lib/tenant';
import { useCart } from './lib/cart';
import { LANG_LABEL, strings } from './lib/strings';
import { load, save, drop } from './lib/storage';
import { applyBranding, applyLang } from './theme';
import { ItemRow, FeaturedCard } from './components/ItemRow';
import { Divider, PoweredBy, Star8 } from './components/Ornament';
import { ItemSheet } from './components/ItemSheet';
import { CartSheet, availableOrderTypes, type Checkout } from './components/CartSheet';
import { OrderTracker, type TrackedOrder } from './components/OrderTracker';
import { ReviewButton } from './components/ReviewButton';

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function App() {
  const tenant = useMemo(() => resolveTenant(), []);
  const slug = tenant.slug ?? '';
  const [state, setState] = useState<LoadState>(tenant.slug ? 'loading' : 'notfound');
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [lang, setLang] = useState('fr');

  const loadMenu = useCallback(async () => {
    if (!tenant.slug) return;
    try {
      const m = await getMenu(tenant.slug, tenant.tableToken);
      if (!m) { setState('notfound'); return; }
      setMenu(m);
      setState('ready');
    } catch {
      setState(s => (s === 'ready' ? s : 'error'));
    }
  }, [tenant]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  // Language: saved choice, else the phone's language, else the restaurant's first language.
  useEffect(() => {
    if (!menu) return;
    const langs = menu.restaurant.languages;
    const asked = new URLSearchParams(window.location.search).get('lang');
    const saved = asked && langs.includes(asked) ? asked : load<string>('lang', 365 * 86400_000);
    const phone = (navigator.language || '').slice(0, 2);
    setLang(saved && langs.includes(saved) ? saved : langs.includes(phone) ? phone : langs[0]);
    applyBranding(menu.restaurant.branding, menu.restaurant.name);
  }, [menu]);
  useEffect(() => { applyLang(lang); }, [lang]);
  const chooseLang = (l: string) => { setLang(l); save('lang', l); };

  const t = strings(lang);
  const cart = useCart(slug, menu);
  const fallbacks = menu?.restaurant.languages ?? [];
  const currency = menu?.restaurant.currency ?? 'MAD';

  // ---------------------------------------------------------------------------
  // Ordering
  // ---------------------------------------------------------------------------
  const types = menu ? availableOrderTypes(menu) : [];
  const defaultType: OrderType = menu?.table && types.includes('dine_in')
    ? 'dine_in' : (types.find(x => x !== 'dine_in') ?? 'dine_in');
  const [checkout, setCheckout] = useState<Checkout>(() => ({
    orderType: 'dine_in', note: '', ...(load<Omit<Checkout, 'orderType' | 'note'>>('customer', 90 * 86400_000)
      ?? { name: '', phone: '', address: '' }),
  }));
  useEffect(() => { setCheckout(c => ({ ...c, orderType: defaultType })); }, [defaultType]);

  // Guests can order when the restaurant accepts orders and there is a way to
  // order from here: a table QR code, or takeaway/delivery.
  const canOrder = !!menu?.ordering_enabled && (!!menu.table || types.some(x => x !== 'dine_in'));

  const [openItem, setOpenItem] = useState<PublicItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const [tracked, setTracked] = useState<TrackedOrder | null>(() => load<TrackedOrder>(`order:${slug}`, 3 * 3600_000));
  const [trackerOpen, setTrackerOpen] = useState(false);
  // a tracking link sent on WhatsApp by the restaurant: ?suivi=<order id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('suivi');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    getOrderStatus(id).then(s => {
      if (!s) return;
      const o: TrackedOrder = { order_id: id, ticket_number: s.ticket_number, total_cents: Number(s.total_cents), placed_at: Date.parse(s.created_at) };
      setTracked(o); setTrackerOpen(true);
    }).catch(() => {});
  }, []);

  // One id per order attempt: a retry after a network error (even after a
  // page refresh) reuses it as long as the cart is unchanged, so the
  // restaurant never receives the same order twice.
  const cartSig = JSON.stringify(cart.lines.map(l => [l.key, l.quantity]));
  const attemptId = () => {
    const p = load<{ id: string; sig: string }>(`pending:${slug}`, 3600_000);
    const id = p && p.sig === cartSig ? p.id : newId();
    save(`pending:${slug}`, { id, sig: cartSig });
    return id;
  };

  const addToCart = (item: PublicItem, variantId: string | null, qty: number, note = '', modifiers: string[] = []) => {
    setError(null);
    // a dish with choices to make opens its sheet instead of a blind quick add
    if (!variantId && !modifiers.length && (item.modifier_groups ?? []).some(g => g.min > 0)) { setOpenItem(item); return; }
    cart.add(item, variantId, qty, note, modifiers);
    setBump(b => b + 1);
  };

  const submit = async () => {
    if (!menu || busy) return;
    setBusy(true);
    setError(null);
    const clientId = attemptId();
    try {
      const isDineIn = checkout.orderType === 'dine_in';
      const res = await placeOrder(slug, {
        client_id: clientId,
        order_type: checkout.orderType,
        table_token: isDineIn ? menu.table?.token ?? null : null,
        customer: isDineIn ? undefined : { name: checkout.name, phone: checkout.phone, address: checkout.address },
        note: checkout.note.trim() || undefined,
        wanted_at: !isDineIn && checkout.wantedAt ? checkout.wantedAt : undefined,
        location: checkout.orderType === 'delivery' && checkout.location ? checkout.location : undefined,
        items: cart.lines.map(l => ({ item_id: l.item_id, variant_id: l.variant_id, modifiers: l.modifiers?.length ? l.modifiers : undefined, quantity: l.quantity, note: l.note || undefined })),
      });
      const order: TrackedOrder = { order_id: res.order_id, ticket_number: res.ticket_number,
                                    total_cents: Number(res.total_cents), placed_at: Date.now() };
      save(`order:${slug}`, order);
      if (!isDineIn) save('customer', { name: checkout.name, phone: checkout.phone, address: checkout.address });
      setTracked(order);
      drop(`pending:${slug}`);
      setCheckout(c => ({ ...c, note: '', wantedAt: '', location: null }));
      setBusy(false);
      cart.clear();
      setCartOpen(false);
      setTrackerOpen(true);
    } catch (e) {
      const code = errorCode(e);
      if (code !== 'network') {
        // the server rejected it and created nothing: a new attempt gets a new id
        drop(`pending:${slug}`);
      }
      const details = e instanceof ApiError ? e.details : undefined;
      let message = t.errors[code];
      if (['item_sold_out', 'item_unavailable', 'variant_required'].includes(code) && details) {
        const it = cart.itemsById.get(details);
        if (it) message = `${tr(it.name, lang, fallbacks)} : ${message}`;
        if (code !== 'variant_required') cart.removeItem(details);
        loadMenu();
      }
      setBusy(false);
      setError(message);
    }
  };

  // ---------------------------------------------------------------------------
  // Search and category scroll spy
  // ---------------------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = fold(query.trim());
  const results = useMemo(() => {
    if (!menu || !q) return [];
    return menu.items.filter(i =>
      [...Object.values(i.name), ...Object.values(i.description)].some(s => fold(s).includes(q)));
  }, [menu, q]);

  const byCategory = useMemo(() => {
    const m = new Map<string, PublicItem[]>();
    for (const i of menu?.items ?? []) m.set(i.category_id, [...(m.get(i.category_id) ?? []), i]);
    return m;
  }, [menu]);

  const [activeCat, setActiveCat] = useState<string | null>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const programmatic = useRef(0);

  useEffect(() => {
    if (!menu || q) return;
    const obs = new IntersectionObserver(entries => {
      if (Date.now() < programmatic.current) return;
      const vis = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActiveCat((vis[0].target as HTMLElement).dataset.cat ?? null);
    }, { rootMargin: '-120px 0px -65% 0px' });
    sectionRefs.current.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [menu, q]);

  useEffect(() => {
    if (activeCat) chipRefs.current.get(activeCat)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeCat]);

  const goTo = (id: string) => {
    setActiveCat(id);
    programmatic.current = Date.now() + 800;
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Signature dishes: tagged "popular" with a photo, else the first dishes with a photo.
  const featured = useMemo(() => {
    const withPhoto = (menu?.items ?? []).filter(i => i.image_url && i.available);
    const pop = withPhoto.filter(i => i.tags.includes('popular'));
    const list = pop.length >= 3 ? pop : withPhoto;
    return list.length >= 3 ? list.slice(0, 8) : [];
  }, [menu]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (state === 'loading') return <Skeleton />;
  if (state === 'notfound' || state === 'error' || !menu) {
    const s = strings((navigator.language || 'fr').slice(0, 2));
    return (
      <div className="relative min-h-dvh grid place-items-center px-8 text-center overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-80 fade-down" aria-hidden><div className="absolute inset-0 zellige zellige-hero" /></div>
        <div className="relative animate-rise">
          <div className="mx-auto grid place-items-center size-20 rounded-full card text-brand">
            <Utensils className="size-8" />
          </div>
          <h1 className="mt-6 font-display text-2xl font-semibold">{state === 'error' ? s.loadError : s.notFound}</h1>
          {state === 'notfound' && <p className="mt-2 text-muted">{s.notFoundHint}</p>}
          {state === 'error' && (
            <button onClick={() => { setState('loading'); loadMenu(); }}
              className="mt-8 h-12 px-8 rounded-full bg-brand text-brand-ink font-semibold glow-brand press">{s.retry}</button>
          )}
          <div className="mt-14"><PoweredBy label={s.poweredBy} /></div>
        </div>
      </div>
    );
  }

  const r = menu.restaurant;
  const b = r.branding ?? {};
  let idx = 0;
  const renderItem = (item: PublicItem) => (
    <ItemRow
      key={item.id}
      index={idx++}
      item={item}
      lang={lang}
      fallbacks={fallbacks}
      currency={currency}
      t={t}
      qty={cart.qtyOfItem(item.id)}
      canOrder={canOrder}
      onOpen={() => setOpenItem(item)}
      onQuickAdd={() => addToCart(item, null, 1)}
    />
  );

  return (
    <div className="min-h-dvh pb-32">
      <div className="mx-auto max-w-2xl">
        {/* Hero */}
        <header className="relative isolate overflow-hidden">
          {b.cover_url ? (
            <div className="absolute inset-0 -z-10" aria-hidden>
              <img src={b.cover_url} alt="" className="w-full h-full object-cover scale-105" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-bg" />
            </div>
          ) : (
            <div className="absolute inset-0 -z-10 hero-glow" aria-hidden>
              <div className="absolute inset-0 fade-down"><div className="absolute inset-0 zellige zellige-hero" /></div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-4 pt-safe">
            {r.languages.length > 1 && (
              <div className="flex rounded-full p-1 bg-surface/70 backdrop-blur-md border border-line" role="group" aria-label="Language">
                {r.languages.map(l => (
                  <button key={l} onClick={() => chooseLang(l)} aria-pressed={l === lang} lang={l}
                    className={`h-8 min-w-9 px-2.5 rounded-full text-xs font-bold transition ${
                      l === lang ? 'bg-brand text-brand-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                    {LANG_LABEL[l] ?? l.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`flex flex-col items-center text-center px-6 pb-8 ${b.cover_url ? 'pt-20 text-white' : 'pt-12'}`}>
            <Logo url={b.logo_url} name={r.name} />
            <p className={`mt-9 text-[11px] font-semibold uppercase tracking-[0.3em] rtl:tracking-normal animate-rise ${b.cover_url ? 'text-white/75' : 'text-brand'}`}
              style={{ ['--i' as string]: 1 }}>{t.welcome}</p>
            <h1 className={`mt-2 font-display text-[2.6rem] sm:text-5xl font-semibold leading-[1.05] animate-rise ${b.cover_url ? 'text-white drop-shadow-lg' : ''}`}
              style={{ ['--i' as string]: 2 }}>{r.name}</h1>
            {b.tagline && (
              <p className={`mt-2 text-[15px] animate-rise ${b.cover_url ? 'text-white/80' : 'text-muted'}`} style={{ ['--i' as string]: 3 }}>
                {tr(b.tagline, lang, fallbacks)}
              </p>
            )}
            <Divider className="mt-5 animate-rise" />

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm animate-rise" style={{ ['--i' as string]: 4 }}>
              {menu.table ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-brand text-brand-ink ps-2 pe-4 py-1.5 font-semibold glow-brand">
                  <span className="grid place-items-center size-6 rounded-full bg-brand-ink/15"><Utensils className="size-3.5" /></span>
                  <span>{t.table} <bdi>{menu.table.label}</bdi></span>
                </span>
              ) : !canOrder ? (
                <span className="inline-flex items-center gap-1.5 rounded-full card px-3.5 py-1.5 font-medium text-muted">
                  <Eye className="size-3.5" />{t.browseOnly}
                </span>
              ) : null}
              {r.address && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 backdrop-blur-md ${
                  b.cover_url ? 'bg-black/30 text-white/90' : 'bg-surface/70 border border-line text-muted'}`}>
                  <MapPin className="size-3.5 shrink-0" /><bdi className="truncate max-w-[16rem]">{r.address}{r.city ? `, ${r.city}` : ''}</bdi>
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="px-5 space-y-3">
          {!menu.ordering_enabled && (
            <p className="rounded-2xl card px-4 py-3 text-sm">{t.orderingOff}</p>
          )}
          {menu.ordering_enabled && !canOrder && (
            <p className="rounded-2xl card px-4 py-3 text-sm">{t.scanTable}</p>
          )}
          {tracked && !trackerOpen && (
            <button onClick={() => setTrackerOpen(true)}
              className="w-full flex items-center gap-3 rounded-2xl card px-3 py-3 text-start press">
              <span className="relative grid place-items-center size-11 rounded-full bg-brand text-brand-ink">
                <span className="absolute inset-0 rounded-full bg-brand animate-pulse-ring" aria-hidden />
                <span dir="ltr" className="relative font-bold text-sm tabular-nums">#{tracked.ticket_number}</span>
              </span>
              <span className="flex-1 font-semibold">{t.ticket} <bdi dir="ltr">#{tracked.ticket_number}</bdi></span>
              <span className="text-sm font-semibold text-brand">{t.trackOrder}</span>
              <ChevronRight className="size-4 text-muted rtl:rotate-180" />
            </button>
          )}
        </div>

        {/* Signature dishes */}
        {!q && featured.length > 0 && (
          <section className="mt-6" aria-labelledby="featured">
            <div className="px-5 flex items-center gap-2">
              <Star8 className="size-3.5 text-brand" />
              <h2 id="featured" className="font-display text-xl font-semibold">{t.featured}</h2>
            </div>
            <div className="mt-3 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory px-5 pb-2 scroll-px-5">
              {featured.map((item, i) => (
                <FeaturedCard key={item.id} item={item} index={i} lang={lang} fallbacks={fallbacks} currency={currency} t={t}
                  canOrder={canOrder} qty={cart.qtyOfItem(item.id)} onOpen={() => setOpenItem(item)}
                  onQuickAdd={() => addToCart(item, null, 1)} />
              ))}
            </div>
          </section>
        )}

        {/* Sticky category bar / search */}
        <nav className="sticky top-0 z-30 mt-5 bg-bg/80 backdrop-blur-xl border-b border-line">
          {searchOpen ? (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <div className="relative flex-1">
                <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search}
                  className="w-full h-11 rounded-full bg-surface border border-line ps-10 pe-4 text-[15px] outline-none focus:border-brand placeholder:text-muted" />
              </div>
              <button onClick={() => { setSearchOpen(false); setQuery(''); }} aria-label={t.searchClear}
                className="grid place-items-center size-11 rounded-full bg-surface border border-line text-muted"><X className="size-4.5" /></button>
            </div>
          ) : (
            <div className="flex items-center">
              <button onClick={() => setSearchOpen(true)} aria-label={t.search}
                className="shrink-0 ms-4 grid place-items-center size-10 rounded-full bg-surface border border-line text-ink press">
                <Search className="size-4.5" />
              </button>
              <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar px-3 py-3">
                {menu.categories.map(c => (
                  <button
                    key={c.id}
                    ref={el => { if (el) chipRefs.current.set(c.id, el); }}
                    onClick={() => goTo(c.id)}
                    className={`shrink-0 h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-300 ${
                      activeCat === c.id ? 'bg-brand text-brand-ink glow-brand' : 'bg-surface border border-line text-ink/80'}`}
                  >
                    {c.icon && <span className="me-1.5" aria-hidden>{c.icon}</span>}
                    {tr(c.name, lang, fallbacks)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Menu */}
        <main className="px-4">
          {q ? (
            results.length === 0
              ? <p className="py-16 text-center text-muted">{t.noResults}</p>
              : <ul className="pt-4 space-y-3">{results.map(renderItem)}</ul>
          ) : (
            menu.categories.map(c => {
              const list = byCategory.get(c.id) ?? [];
              return (
                <section
                  key={c.id}
                  data-cat={c.id}
                  ref={el => { if (el) sectionRefs.current.set(c.id, el); }}
                  className="scroll-mt-20 pt-8"
                >
                  <div className="flex items-center gap-3 px-1 mb-3">
                    <h2 className="font-display text-2xl font-semibold">{tr(c.name, lang, fallbacks)}</h2>
                    <span className="flex-1 h-px bg-gradient-to-r from-line to-transparent rtl:bg-gradient-to-l" />
                    <span className="text-xs font-medium text-muted tabular-nums">{list.length}</span>
                  </div>
                  <ul className="space-y-3">{list.map(renderItem)}</ul>
                </section>
              );
            })
          )}
          <footer className="mt-16 flex flex-col items-center gap-3 text-center">
            <Divider />
            <p className="font-display text-lg font-semibold">{r.name}</p>
            {r.phone && <a href={`tel:${r.phone}`} dir="ltr" className="text-sm text-muted">{r.phone}</a>}
            <div className="mt-4"><ReviewButton url={r.branding?.review_url} label={t.reviewCta} hint={t.reviewHint} /></div>
            <div className="mt-4"><PoweredBy label={t.poweredBy} /></div>
          </footer>
        </main>
      </div>

      {/* Cart bar */}
      {canOrder && cart.count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-safe pt-8 pointer-events-none bg-gradient-to-t from-bg via-bg/70 to-transparent">
          <button
            key={bump}
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto mx-auto max-w-xl w-full h-16 rounded-full bg-brand text-brand-ink glow-brand flex items-center gap-3 ps-2 pe-6 animate-bump"
          >
            <span className="relative grid place-items-center size-12 rounded-full bg-brand-ink/15">
              <ShoppingBag className="size-5" />
              <span className="absolute -top-1 -end-1 grid place-items-center min-w-5 h-5 px-1 rounded-full bg-brand-ink text-brand text-[11px] font-bold tabular-nums">
                {cart.count}
              </span>
            </span>
            <span className="flex-1 text-start font-semibold text-[15px]">{t.viewCart}</span>
            <span className="font-bold tabular-nums text-[15px]">{formatMoney(cart.total, currency, lang)}</span>
          </button>
        </div>
      )}

      <ItemSheet
        item={openItem}
        lang={lang}
        fallbacks={fallbacks}
        currency={currency}
        t={t}
        canOrder={canOrder}
        onClose={() => setOpenItem(null)}
        onAdd={(variantId, qty, note, mods) => { if (openItem) { setError(null); cart.add(openItem, variantId, qty, note, mods); setBump(b => b + 1); } setOpenItem(null); }}
      />
      <CartSheet
        open={cartOpen}
        onClose={() => { setCartOpen(false); setError(null); }}
        menu={menu}
        cart={cart}
        lang={lang}
        fallbacks={fallbacks}
        t={t}
        checkout={checkout}
        setCheckout={setCheckout}
        onSubmit={submit}
        busy={busy}
        error={error}
      />
      {tracked && trackerOpen && (
        <OrderTracker
          order={tracked}
          t={t}
          lang={lang}
          currency={currency}
          tableLabel={menu.table?.label ?? null}
          restaurantName={r.name}
          reviewUrl={r.branding?.review_url}
          timezone={r.timezone}
          onClose={() => setTrackerOpen(false)}
        />
      )}
    </div>
  );
}

function Logo({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="relative grid place-items-center size-44 animate-pop">
      {/* soft glow + star emblem behind; the logo itself is shown whole, whatever its shape */}
      <div className="absolute inset-6 rounded-full bg-brand/15 blur-2xl" aria-hidden />
      <Star8 filled={false} stroke={0.22} className="absolute inset-0 size-full text-brand opacity-45 animate-spin-slow" />
      <Star8 filled={false} stroke={0.22} className="absolute inset-0 size-full text-brand opacity-15 rotate-[22.5deg]" />
      {url && !failed ? (
        <img src={url} alt="" onError={() => setFailed(true)}
          className="relative max-h-32 max-w-36 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.45)]" />
      ) : (
        <div className="relative size-24 rounded-full bg-surface ring-brand-soft grid place-items-center">
          <span className="font-display text-3xl font-semibold text-brand">{initials || '•'}</span>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-16" aria-busy="true">
      <div className="mx-auto size-24 rounded-full shimmer" />
      <div className="mx-auto mt-6 h-3 w-24 rounded-full shimmer" />
      <div className="mx-auto mt-3 h-9 w-56 rounded-xl shimmer" />
      <div className="mx-auto mt-3 h-4 w-40 rounded-full shimmer" />
      <div className="mt-10 flex gap-3 overflow-hidden">{[0, 1, 2].map(i => <div key={i} className="shrink-0 h-64 w-52 rounded-3xl shimmer" />)}</div>
      <div className="mt-8 flex gap-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 w-24 rounded-full shimmer" />)}</div>
      {[0, 1, 2, 3].map(i => <div key={i} className="mt-3 h-32 rounded-3xl shimmer" />)}
    </div>
  );
}
