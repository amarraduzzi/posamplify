import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ShoppingBag, MapPin, Utensils, Eye, ChevronRight } from 'lucide-react';
import { errorCode, formatMoney, newId, tr, type OrderType, type PublicItem, type PublicMenu } from '@resto/shared';
import { getMenu, placeOrder, ApiError } from './lib/api';
import { resolveTenant } from './lib/tenant';
import { useCart } from './lib/cart';
import { LANG_LABEL, strings } from './lib/strings';
import { load, save, drop } from './lib/storage';
import { applyBranding, applyLang } from './theme';
import { ItemRow } from './components/ItemRow';
import { ItemSheet } from './components/ItemSheet';
import { CartSheet, availableOrderTypes, type Checkout } from './components/CartSheet';
import { OrderTracker, type TrackedOrder } from './components/OrderTracker';

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
    const saved = load<string>('lang', 365 * 86400_000);
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

  const addToCart = (item: PublicItem, variantId: string | null, qty: number, note = '') => {
    setError(null);
    cart.add(item, variantId, qty, note);
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
        items: cart.lines.map(l => ({ item_id: l.item_id, variant_id: l.variant_id, quantity: l.quantity, note: l.note || undefined })),
      });
      const order: TrackedOrder = { order_id: res.order_id, ticket_number: res.ticket_number,
                                    total_cents: Number(res.total_cents), placed_at: Date.now() };
      save(`order:${slug}`, order);
      if (!isDineIn) save('customer', { name: checkout.name, phone: checkout.phone, address: checkout.address });
      setTracked(order);
      drop(`pending:${slug}`);
      setCheckout(c => ({ ...c, note: '' }));
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (state === 'loading') return <Skeleton />;
  if (state === 'notfound' || state === 'error' || !menu) {
    const s = strings((navigator.language || 'fr').slice(0, 2));
    return (
      <div className="min-h-dvh grid place-items-center px-8 text-center">
        <div>
          <Utensils className="mx-auto size-10 text-muted" />
          <h1 className="mt-4 text-xl font-bold">{state === 'error' ? s.loadError : s.notFound}</h1>
          {state === 'notfound' && <p className="mt-2 text-muted">{s.notFoundHint}</p>}
          {state === 'error' && (
            <button onClick={() => { setState('loading'); loadMenu(); }}
              className="mt-6 h-11 px-6 rounded-full bg-ink text-bg font-semibold">{s.retry}</button>
          )}
        </div>
      </div>
    );
  }

  const r = menu.restaurant;
  const b = r.branding ?? {};
  const renderItem = (item: PublicItem) => (
    <ItemRow
      key={item.id}
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
    <div className="min-h-dvh pb-28">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <header className="relative">
          {b.cover_url ? (
            <div className="h-40 sm:h-52 overflow-hidden sm:rounded-b-3xl">
              <img src={b.cover_url} alt="" className="w-full h-full object-cover" />
            </div>
          ) : <div className="h-4" />}
          <div className={`px-5 ${b.cover_url ? '-mt-10' : 'pt-4'}`}>
            <div className="flex items-end gap-4">
              {b.logo_url && (
                <img src={b.logo_url} alt="" className="size-18 rounded-2xl object-cover bg-surface ring-4 ring-bg shadow-md shrink-0" />
              )}
              <div className="flex-1" />
              {r.languages.length > 1 && (
                <div className="flex rounded-full bg-surface-2 p-1 mb-1" role="group" aria-label="Language">
                  {r.languages.map(l => (
                    <button key={l} onClick={() => chooseLang(l)} aria-pressed={l === lang} lang={l}
                      className={`h-8 min-w-9 px-2.5 rounded-full text-xs font-bold transition ${
                        l === lang ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
                      {LANG_LABEL[l] ?? l.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold leading-tight">{r.name}</h1>
            {b.tagline && <p className="text-muted">{tr(b.tagline, lang, fallbacks)}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {menu.table ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand text-brand-ink px-3 py-1 font-semibold">
                  <Utensils className="size-3.5" />{t.table} <bdi>{menu.table.label}</bdi>
                </span>
              ) : !canOrder ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 font-medium text-muted">
                  <Eye className="size-3.5" />{t.browseOnly}
                </span>
              ) : null}
              {r.address && (
                <span className="inline-flex items-center gap-1 text-muted">
                  <MapPin className="size-3.5" /><bdi>{r.address}{r.city ? `, ${r.city}` : ''}</bdi>
                </span>
              )}
            </div>

            {!menu.ordering_enabled && (
              <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">{t.orderingOff}</p>
            )}
            {menu.ordering_enabled && !canOrder && (
              <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">{t.scanTable}</p>
            )}

            {tracked && !trackerOpen && (
              <button onClick={() => setTrackerOpen(true)}
                className="mt-4 w-full flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start">
                <span dir="ltr" className="grid place-items-center size-9 rounded-full bg-brand text-brand-ink font-bold text-sm tabular-nums">
                  #{tracked.ticket_number}
                </span>
                <span className="flex-1 font-medium">{t.ticket} <bdi dir="ltr">#{tracked.ticket_number}</bdi></span>
                <span className="text-sm font-semibold text-brand">{t.trackOrder}</span>
                <ChevronRight className="size-4 text-muted rtl:rotate-180" />
              </button>
            )}
          </div>
        </header>

        {/* Sticky category bar / search */}
        <nav className="sticky top-0 z-30 mt-5 bg-bg border-b border-line">
          {searchOpen ? (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <div className="relative flex-1">
                <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search}
                  className="w-full h-10 rounded-full bg-surface-2 ps-10 pe-4 text-sm outline-none placeholder:text-muted" />
              </div>
              <button onClick={() => { setSearchOpen(false); setQuery(''); }} aria-label={t.searchClear}
                className="grid place-items-center size-10 rounded-full bg-surface-2 text-muted"><X className="size-4.5" /></button>
            </div>
          ) : (
            <div className="flex items-center">
              <button onClick={() => setSearchOpen(true)} aria-label={t.search}
                className="shrink-0 ms-3 grid place-items-center size-10 rounded-full bg-surface-2 text-muted">
                <Search className="size-4.5" />
              </button>
              <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar px-3 py-2.5">
                {menu.categories.map(c => (
                  <button
                    key={c.id}
                    ref={el => { if (el) chipRefs.current.set(c.id, el); }}
                    onClick={() => goTo(c.id)}
                    className={`shrink-0 h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                      activeCat === c.id ? 'bg-ink text-bg' : 'bg-surface-2 text-ink'}`}
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
        <main className="px-5">
          {q ? (
            results.length === 0
              ? <p className="py-16 text-center text-muted">{t.noResults}</p>
              : <ul className="divide-y divide-line">{results.map(renderItem)}</ul>
          ) : (
            menu.categories.map(c => (
              <section
                key={c.id}
                data-cat={c.id}
                ref={el => { if (el) sectionRefs.current.set(c.id, el); }}
                className="scroll-mt-16 pt-7"
              >
                <h2 className="font-display text-xl font-bold flex items-center gap-2">
                  {c.icon && <span aria-hidden>{c.icon}</span>}{tr(c.name, lang, fallbacks)}
                </h2>
                <ul className="divide-y divide-line">{(byCategory.get(c.id) ?? []).map(renderItem)}</ul>
              </section>
            ))
          )}
          <footer className="mt-12 text-center text-xs text-muted">
            {r.phone && <p>{r.phone}</p>}
            <p className="mt-1 opacity-70">{t.poweredBy}</p>
          </footer>
        </main>
      </div>

      {/* Cart bar */}
      {canOrder && cart.count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-safe pt-3 pointer-events-none">
          <button
            key={bump}
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto mx-auto max-w-xl w-full h-14 rounded-full bg-brand text-brand-ink shadow-2xl flex items-center gap-3 px-3 animate-bump"
          >
            <span className="relative grid place-items-center size-9 rounded-full bg-brand-ink text-brand">
              <ShoppingBag className="size-4.5" />
            </span>
            <span className="flex-1 text-start font-semibold">
              {t.viewCart}
              <span className="block text-xs font-medium opacity-80">{t.items(cart.count)}</span>
            </span>
            <span className="pe-3 font-bold tabular-nums">{formatMoney(cart.total, currency, lang)}</span>
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
        onAdd={(variantId, qty, note) => { if (openItem) addToCart(openItem, variantId, qty, note); setOpenItem(null); }}
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
          onClose={() => setTrackerOpen(false)}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-8 animate-pulse" aria-busy="true">
      <div className="size-16 rounded-2xl bg-surface-2" />
      <div className="mt-4 h-7 w-48 rounded-lg bg-surface-2" />
      <div className="mt-2 h-4 w-32 rounded bg-surface-2" />
      <div className="mt-8 flex gap-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 w-24 rounded-full bg-surface-2" />)}</div>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="mt-6 flex gap-4">
          <div className="flex-1 space-y-2"><div className="h-4 w-2/3 rounded bg-surface-2" /><div className="h-3 w-full rounded bg-surface-2" /><div className="h-4 w-16 rounded bg-surface-2" /></div>
          <div className="size-24 rounded-2xl bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
