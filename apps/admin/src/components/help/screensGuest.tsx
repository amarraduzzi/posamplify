import type { ReactNode } from 'react';
import { Btn, Chip, Field, Phone, tr, type ScreenDef } from './kit';

const W = 300, H = 580;
const Top = ({ children }: { children?: ReactNode }) => (
  <div className="flex shrink-0 items-center justify-between px-3 py-2"><span className="font-display text-sm font-bold">Chez Salma</span>{children}</div>
);
const Item = ({ n, p, h, off }: { n: string; p: number; h?: string; off?: boolean }) => (
  <div data-h={h} className={`flex items-center gap-2 rounded-2xl bg-surface p-2 ring-1 ring-line/10 ${off ? 'opacity-60' : ''}`}>
    <div className="h-11 w-11 shrink-0 rounded-xl bg-surface-3" /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold">{n}</p><p className="text-xs text-muted">{p} MAD</p></div>
    {off ? <Chip>{tr('Épuisé', 'Sold out', 'نفد')}</Chip> : <span className="grid h-7 w-7 place-items-center rounded-full gold-fill text-lg font-bold text-brand-ink">+</span>}
  </div>
);
const Sheet = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-auto rounded-t-3xl bg-surface p-3 shadow-[0_-8px_30px_-10px_rgba(0,0,0,.3)]"><p className="mb-2 font-display text-sm font-bold">{title}</p>{children}</div>
);
const body = 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3';

const Menu = () => (
  <Phone><Top><span data-h="lang" className="flex gap-1 text-[11px] font-bold"><Chip on>FR</Chip><Chip>EN</Chip><Chip>ع</Chip></span></Top>
    <div className={body}>
      <div data-h="search" className="rounded-xl border border-line/15 bg-surface px-3 py-2 text-xs text-muted">🔍 {tr('Rechercher un plat', 'Search for a dish', 'ابحث عن طبق')}</div>
      <div data-h="stars"><p className="mb-1 text-xs font-extrabold">★ {tr('Nos incontournables', 'Our must-tries', 'أطباقنا المميزة')}</p><div className="flex gap-2"><div className="h-16 flex-1 rounded-2xl bg-brand/15 p-2 text-xs font-bold">Tajine<br /><span className="text-[10px] text-brand">{tr('Populaire', 'Popular', 'شائع')}</span></div><div className="h-16 flex-1 rounded-2xl bg-warn/15 p-2 text-xs font-bold">Pastilla<br /><span className="text-[10px] text-warn">{tr('Nouveau', 'New', 'جديد')}</span></div></div></div>
      <Item n="Cappuccino" p={18} /><Item n={tr('Thé à la menthe', 'Mint tea', 'أتاي بالنعناع')} p={12} /><Item h="soldout" off n={tr('Jus d’orange', 'Orange juice', 'عصير البرتقال')} p={20} />
      <div data-h="call" className="mt-auto rounded-2xl bg-ink px-3 py-2.5 text-center text-xs font-bold text-white">🔔 {tr('Besoin de quelque chose ?', 'Need anything?', 'تحتاج شيئًا؟')}</div>
    </div></Phone>
);

const Cart = () => (
  <Phone><Top />
    <div className="flex min-h-0 flex-1 flex-col bg-black/10 pt-6">
      <Sheet title={tr('Votre panier', 'Your basket', 'سلتك')}>
        <div className="mb-2 text-[13px] font-semibold"><div className="flex justify-between py-0.5"><span>2 × Cappuccino</span><span>36 MAD</span></div><div className="flex justify-between py-0.5"><span>1 × Tajine</span><span>65 MAD</span></div></div>
        <div data-h="note" className="mb-2 rounded-lg border border-line/15 px-2 py-1.5 text-xs text-muted">{tr('Note pour la cuisine (allergies…)', 'Note for the kitchen (allergies…)', 'ملاحظة للمطبخ (حساسية…)')}</div>
        <div data-h="mode" className="mb-2 flex gap-1"><Chip on>{tr('Sur place', 'Dine in', 'في المكان')}</Chip><Chip>{tr('À emporter', 'Takeaway', 'للأخذ')}</Chip><Chip>{tr('Livraison', 'Delivery', 'توصيل')}</Chip></div>
        <div data-h="promo" className="mb-2 flex gap-1.5"><div className="flex-1 rounded-lg border border-line/15 px-2 py-1.5 text-xs text-muted" dir="ltr">BIENVENUE10</div><Btn tone="soft">{tr('Appliquer', 'Apply', 'تطبيق')}</Btn></div>
        <Btn h="order" className="w-full !py-2.5">{tr('Commander', 'Order', 'اطلب')} · 91 MAD</Btn>
      </Sheet>
    </div></Phone>
);

const Track = () => (
  <Phone><Top />
    <div className={body}>
      <p className="text-base font-extrabold">{tr('Votre commande', 'Your order', 'طلبك')} #27</p>
      <div data-h="status" className="space-y-1.5 rounded-2xl bg-surface p-3 ring-1 ring-line/10 text-[13px] font-bold">
        <p className="text-ok">✓ {tr('Reçue', 'Received', 'تم الاستلام')}</p><p className="text-brand">● {tr('En préparation', 'Being prepared', 'قيد التحضير')}</p><p className="text-muted">○ {tr('Prête', 'Ready', 'جاهز')}</p><p className="text-muted">○ {tr('Servie', 'Served', 'قُدِّم')}</p>
      </div>
      <p className="text-xs font-semibold text-muted">{tr('Prête vers 13:20', 'Ready around 13:20', 'جاهز حوالي 13:20')}</p>
      <div data-h="code" className="rounded-2xl bg-brand/10 p-3 text-center"><p className="text-[11px] font-bold text-muted">{tr('Code de livraison', 'Delivery code', 'رمز التسليم')}</p><p className="font-display text-2xl font-bold tracking-[0.2em] text-brand" dir="ltr">4821</p></div>
      <Btn h="wa" tone="soft" className="mt-auto w-full">💬 {tr('Écrire au restaurant sur WhatsApp', 'Message the restaurant on WhatsApp', 'راسل المطعم عبر واتساب')}</Btn>
    </div></Phone>
);

const Allergy = () => (
  <Phone><Top />
    <div className="flex min-h-0 flex-1 flex-col bg-black/10 pt-10">
      <Sheet title={tr('Une allergie ?', 'An allergy?', 'حساسية؟')}>
        <p className="mb-2 text-xs font-semibold text-muted">{tr('Masquer les plats avec :', 'Hide dishes containing:', 'إخفاء الأطباق التي تحتوي على:')}</p>
        <div data-h="chips" className="mb-3 flex flex-wrap gap-1.5"><Chip on>Gluten</Chip><Chip>{tr('Arachides', 'Peanuts', 'فول سوداني')}</Chip><Chip on>{tr('Lait', 'Milk', 'حليب')}</Chip><Chip>{tr('Œufs', 'Eggs', 'بيض')}</Chip></div>
        <Btn h="all" tone="soft" className="w-full">{tr('Tout afficher', 'Show all', 'إظهار الكل')}</Btn>
        <p className="mt-2 text-[10.5px] text-muted">{tr('Indicatif : en cas d’allergie, dites-le au personnel.', 'For guidance only: if you have an allergy, tell the staff.', 'للإرشاد فقط: في حال الحساسية أخبر العاملين.')}</p>
      </Sheet>
    </div></Phone>
);

const Book = () => (
  <Phone><Top />
    <div className={body}>
      <p className="text-base font-extrabold">{tr('Réserver une table', 'Book a table', 'احجز طاولة')}</p>
      <div data-h="when" className="space-y-1.5"><div className="flex gap-1.5"><Chip on>{tr('Demain', 'Tomorrow', 'غدًا')}</Chip><Chip>{tr('Sam.', 'Sat.', 'السبت')}</Chip></div><div className="flex gap-1.5"><Chip>19:30</Chip><Chip on>20:00</Chip><Chip>20:30</Chip></div><p className="text-xs font-bold">{tr('4 personnes', '4 guests', '4 أشخاص')}</p></div>
      <div data-h="who" className="space-y-1.5"><Field label={tr('Prénom', 'First name', 'الاسم')} value="Salma" /><Field label="WhatsApp" value={<span dir="ltr">06 •• •• •• 12</span>} /></div>
      <Btn h="send" className="w-full !py-2.5">{tr('Envoyer la demande', 'Send the request', 'إرسال الطلب')}</Btn>
      <div data-h="queue" className="rounded-xl bg-warn/10 p-2 text-center text-xs font-bold text-warn">{tr('Complet ? Rejoindre la file', 'Full? Join the queue', 'ممتلئ؟ انضم إلى قائمة الانتظار')}</div>
    </div></Phone>
);

const Club = () => (
  <Phone><Top />
    <div className={body}>
      <div data-h="join" className="rounded-2xl bg-surface p-3 ring-1 ring-line/10"><p className="mb-2 text-sm font-extrabold">{tr('Rejoindre le club', 'Join the club', 'انضم إلى النادي')}</p><div className="space-y-1.5"><Field label={tr('Prénom', 'First name', 'الاسم')} value="Salma" /><Field label="WhatsApp" value={<span dir="ltr">06 •• •• •• 12</span>} /></div></div>
      <div data-h="points" className="gold-fill rounded-2xl p-3 text-brand-ink"><p className="text-[11px] font-bold opacity-80">{tr('Ma carte fidélité', 'My loyalty card', 'بطاقة الولاء')}</p><p className="font-display text-3xl font-bold">120 pts</p></div>
      <div data-h="rewards" className="rounded-2xl bg-surface p-3 text-[13px] font-bold ring-1 ring-line/10">🎁 {tr('Un café offert · 100 pts', 'A free coffee · 100 pts', 'قهوة مجانية · 100 نقطة')}</div>
    </div></Phone>
);

const Story = () => (
  <Phone><Top />
    <div className={body}>
      <div data-h="story" className="mx-auto w-[190px] rotate-[-2deg] rounded-md bg-white p-2 shadow-lg ring-1 ring-line/10"><div className="h-[120px] rounded bg-warn/20" /><p className="mt-1.5 text-center text-[11px] font-bold">{tr('Ce tajine est une dinguerie 😋', 'This tajine is unreal 😋', 'هذا الطاجين خرافي 😋')}</p></div>
      <Btn className="w-full">{tr('Poster ma story', 'Post my story', 'انشر قصتي')}</Btn>
      <div data-h="gift" className="rounded-2xl bg-brand/10 p-3 text-center"><p className="text-xs font-bold">🎁 {tr('Votre cadeau', 'Your gift', 'هديتك')}</p><p className="font-display text-lg font-bold tracking-widest text-brand" dir="ltr">CADEAU-7K2P</p></div>
      <Btn h="review" tone="soft" className="w-full">⭐ {tr('Laisser un avis Google', 'Leave a Google review', 'اترك تقييمًا على Google')}</Btn>
    </div></Phone>
);

const g = (render: () => ReactNode): ScreenDef => ({ w: W, h: H, render });
export const GUEST_SCREENS: Record<string, ScreenDef> = {
  'g-menu': g(() => <Menu />), 'g-cart': g(() => <Cart />), 'g-track': g(() => <Track />), 'g-allergy': g(() => <Allergy />),
  'g-book': g(() => <Book />), 'g-club': g(() => <Club />), 'g-story': g(() => <Story />),
};
