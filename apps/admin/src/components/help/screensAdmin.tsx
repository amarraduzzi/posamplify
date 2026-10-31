import { Plus, Eye, ChevronUp, ChevronDown, QrCode, Printer, Upload, Check, Search, Image as Img } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Admin, Btn, Card, Chip, Field, Modal, tr, type ScreenDef } from './kit';

const W = 760, H = 440;
const Row = ({ children, h, className = '' }: { children: React.ReactNode; h?: string; className?: string }) =>
  <div data-h={h} className={`flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-[13px] font-semibold ring-1 ring-line/10 ${className}`}>{children}</div>;
const Over = ({ children }: { children: React.ReactNode }) => <div className="relative h-full">{children}</div>;

// ---- Caisses
const Devices = ({ modal }: { modal?: boolean }) => (
  <Over>
    <Admin active="devices" title={t('Caisses')} right={<Btn h="link"><Plus className="h-3.5 w-3.5" />{t('Relier une caisse')}</Btn>}>
      <Row className="mb-2.5"><div><p>{tr('Caisse comptoir', 'Counter till', 'صندوق الكاونتر')}</p><p className="text-xs font-medium text-muted">{t('Reliée le {d}', { d: '12/10' })}</p></div><Btn h="remove" tone="danger">{t('Retirer')}</Btn></Row>
      <Card h="apk" className="flex items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-surface-2"><QrCode className="h-9 w-9" /></div>
        <div><p className="text-sm font-bold">{t('Tablette Android : l’application Amplify Caisse')}</p><p className="mt-0.5 text-xs text-muted">{t('Scannez le QR code avec la tablette et ouvrez le fichier.')}</p></div>
      </Card>
    </Admin>
    {modal && (
      <Modal title={t('Relier une caisse')} w={340}>
        <Field label={tr('Nom de l’appareil', 'Device name', 'اسم الجهاز')} value={tr('Caisse comptoir', 'Counter till', 'صندوق الكاونتر')} className="mb-3" />
        <div data-h="code" className="rounded-xl bg-brand/10 py-3 text-center font-display text-3xl font-bold tracking-[0.25em] text-brand" dir="ltr">483 920</div>
        <p className="mt-2 text-center text-xs text-muted">{tr('Valable quelques minutes · un seul usage', 'Valid for a few minutes · single use', 'صالح لدقائق · استعمال واحد')}</p>
      </Modal>
    )}
  </Over>
);

// ---- Personnel
const Staff = ({ modal }: { modal?: boolean }) => (
  <Over>
    <Admin active="staff" title={t('Personnel')} right={<Btn h="add"><Plus className="h-3.5 w-3.5" />{t('Ajouter')}</Btn>}>
      <div className="space-y-2">
        <Row><span>Youssef</span><Chip on>{t('Manager')}</Chip></Row>
        <Row><span>Salma</span><Chip>{t('Employé')}</Chip></Row>
        <Row><span>Karim</span><Chip>{t('Employé')}</Chip></Row>
      </div>
    </Admin>
    {modal && (
      <Modal title={t('Nouvel employé')} w={340}>
        <Field label={t('Prénom (affiché sur la caisse)')} value="Salma" h="name" className="mb-2" />
        <Field label={t('Rôle')} value={<span className="flex gap-1.5"><Chip>{t('Employé')}</Chip><Chip on>{t('Manager')}</Chip></span>} h="role" className="mb-2" />
        <Field label={t('Code (4 à 6 chiffres)')} value={<span dir="ltr" className="tracking-[0.3em]">• • • •</span>} h="code" className="mb-3" />
        <div className="flex justify-end"><Btn h="save">{t('Enregistrer')}</Btn></div>
      </Modal>
    )}
  </Over>
);

// ---- Menu
const Dish = ({ n, p, h, off }: { n: string; p: string; h?: boolean; off?: boolean }) => (
  <Row className={off ? 'opacity-60' : ''}>
    <span>{n} <span className="text-muted">· {p} MAD</span></span>
    <span className="flex items-center gap-1.5" data-h={h ? 'avail' : undefined}>
      <Chip h={h ? 'soldout' : undefined} on={off}>{t('Épuisé')}</Chip>
      <span data-h={h ? 'eye' : undefined} className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2"><Eye className="h-3.5 w-3.5" /></span>
    </span>
  </Row>
);
const MenuP = ({ modal }: { modal?: React.ReactNode }) => (
  <Over>
    <Admin active="menu" title={t('Menu')} right={<><Btn h="import" tone="soft"><Upload className="h-3.5 w-3.5" />{t('Importer mon menu')}</Btn><Btn h="mods" tone="soft">{t('Suppléments et formules')}</Btn></>}>
      <div className="grid grid-cols-[170px_1fr] gap-3">
        <div>
          <p className="mb-1.5 flex items-center justify-between text-xs font-bold text-muted">{t('Catégories')}<Btn h="add-cat" className="!px-2 !py-0.5 text-[11px]"><Plus className="h-3 w-3" />{t('Ajouter')}</Btn></p>
          <div data-h="cats" className="space-y-1.5">
            {[tr('Boissons', 'Drinks', 'مشروبات'), tr('Plats', 'Mains', 'أطباق'), tr('Desserts', 'Desserts', 'حلويات')].map((c, i) => (
              <Row key={c} className={i === 0 ? '!bg-brand/10 !ring-brand/30' : ''}><span>{c}</span><span className="flex"><ChevronUp className="h-3.5 w-3.5 text-muted" /><ChevronDown className="h-3.5 w-3.5 text-muted" /></span></Row>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span data-h="search" className="flex flex-1 items-center gap-1.5 rounded-xl border border-line/15 bg-surface px-2.5 py-1.5 text-xs text-muted"><Search className="h-3.5 w-3.5" />{t('Chercher un article')}</span>
            <Btn h="add-item"><Plus className="h-3.5 w-3.5" />{t('Ajouter un article')}</Btn>
          </div>
          <div className="space-y-1.5">
            <Dish n="Cappuccino" p="18" /><Dish n={tr('Thé à la menthe', 'Mint tea', 'أتاي بالنعناع')} p="12" h /><Dish n={tr('Jus d’orange', 'Orange juice', 'عصير البرتقال')} p="20" off />
          </div>
        </div>
      </div>
    </Admin>
    {modal}
  </Over>
);
const MenuCat = () => <MenuP modal={
  <Modal title={t('Modifier la catégorie')} w={430}>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('Nom')} value={tr('Plats', 'Mains', 'أطباق')} /><Field label={t('Icône')} value="🍽️" />
      <Field h="printer" label={t('Préparé à')} value={tr('Cuisine', 'Kitchen', 'المطبخ')} />
      <Field h="service" label={t('Service')} value={t('Envoyé tout de suite')} />
      <Field h="takeaway" label={tr('À emporter : moins cher de (DH)', 'Takeaway: cheaper by (MAD)', 'للأخذ: أرخص بـ (درهم)')} value="1" className="col-span-2" />
    </div>
    <div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs font-bold"><Check className="h-4 w-4 text-brand" />{tr('Visible sur le menu et la caisse', 'Visible on the menu and the till', 'ظاهر في القائمة والصندوق')}</span><Btn>{t('Enregistrer')}</Btn></div>
  </Modal>} />;
const MenuItem = () => <MenuP modal={
  <Modal title={t('Nouvel article')} w={480}>
    <div className="grid grid-cols-[1fr_1fr_84px] gap-2">
      <Field label={t('Nom')} value={tr('Thé à la menthe', 'Mint tea', 'أتاي بالنعناع')} /><Field label={tr('Prix (MAD)', 'Price (MAD)', 'الثمن (درهم)')} value="12" />
      <div data-h="photo" className="row-span-2 grid place-items-center rounded-xl border-2 border-dashed border-line/20 text-muted"><Img className="h-6 w-6" /></div>
      <Field label={t('Description')} value="" className="col-span-2" />
      <Field h="variants" label={tr('Tailles / options (facultatif)', 'Sizes / options (optional)', 'الأحجام / الخيارات (اختياري)')} value={<span className="flex gap-1.5"><Chip>S 12</Chip><Chip>M 15</Chip><Chip>L 18</Chip></span>} className="col-span-3" />
      <Field h="glovo" label={tr('Prix Glovo', 'Glovo price', 'ثمن Glovo')} value="15" />
      <Field h="barcode" label={t('Code-barres')} value="6111…" />
      <Field h="weight" label={tr('Vendu au poids', 'Sold by weight', 'يُباع بالوزن')} value="—" />
    </div>
    <div className="mt-3 flex justify-end"><Btn>{t('Enregistrer')}</Btn></div>
  </Modal>} />;
const MenuMods = () => <MenuP modal={
  <Modal title={t('Suppléments et formules')} w={470}>
    <Field label={t('Nom')} value={tr('Cuisson', 'Cooking', 'درجة الطهي')} className="mb-2" />
    <p className="mb-1 text-[11px] font-bold text-muted">{tr('Ce que fait le client', 'What the customer does', 'ما يفعله الزبون')}</p>
    <div data-h="kind" className="mb-2 flex gap-1.5"><Chip>{tr('Suppléments', 'Extras', 'إضافات')}</Chip><Chip on>{tr('Choix obligatoire', 'Required choice', 'اختيار إجباري')}</Chip><Chip>{tr('Sur mesure', 'Custom', 'مخصّص')}</Chip></div>
    <div data-h="opts" className="mb-2 space-y-1"><Row>{tr('Saignant', 'Rare', 'نصف مطبوخ')}<span className="text-muted">0</span></Row><Row>{tr('À point', 'Medium', 'متوسط')}<span className="text-muted">0</span></Row><Row>{tr('Bien cuit', 'Well done', 'مطبوخ جيدًا')}<span className="text-muted">+5</span></Row></div>
    <Field h="dishes" label={tr('Sur quels plats ?', 'Which dishes?', 'على أي أطباق؟')} value={<span className="flex gap-1.5"><Chip on>Entrecôte</Chip><Chip on>Brochettes</Chip><Chip>Tajine</Chip></span>} />
  </Modal>} />;
const MenuImport = () => <MenuP modal={
  <Modal title={t('Importer mon menu')} w={480}>
    <div data-h="file" className="mb-2 grid grid-cols-2 gap-2 text-center text-xs font-bold">
      <div className="rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 py-3">📷 {tr('Photo ou PDF de la carte', 'Photo or PDF of the menu', 'صورة أو PDF للقائمة')}</div>
      <div className="rounded-xl border-2 border-dashed border-line/20 py-3">📊 {tr('Fichier Excel ou CSV', 'Excel or CSV file', 'ملف Excel أو CSV')}</div>
    </div>
    <div data-h="review" className="mb-2 space-y-1"><Row><span>☑ Cappuccino</span><span className="text-muted">18</span></Row><Row><span>☑ {tr('Tajine poulet', 'Chicken tajine', 'طاجين الدجاج')}</span><span className="text-muted">65</span></Row><Row className="opacity-60"><span>☐ ???</span><span className="text-warn">0</span></Row></div>
    <div className="flex items-center justify-between"><span data-h="undo" className="text-xs font-bold text-danger">{tr('Annuler cet import', 'Undo this import', 'إلغاء هذا الاستيراد')}</span><Btn h="go">{tr('Importer 2 articles', 'Import 2 items', 'استيراد صنفين')}</Btn></div>
  </Modal>} />;

// ---- Tables
const Tables = () => (
  <Over>
    <Admin active="tables" title={t('Tables & QR codes')} right={<><Btn h="print" tone="soft"><Printer className="h-3.5 w-3.5" />{t('Imprimer tous les QR codes')}</Btn><Btn h="add"><Plus className="h-3.5 w-3.5" />{t('Ajouter des tables')}</Btn></>}>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map(n => (
          <Card key={n} h={n === 1 ? 'one' : undefined} className="text-center"><QrCode className="mx-auto h-10 w-10" /><p className="mt-1 text-xs font-bold">{t('Table {n}', { n })}</p>{n === 1 && <span data-h="regen" className="mt-1 inline-block text-[10px] font-bold text-brand">{t('Générer un nouveau QR code')}</span>}</Card>
        ))}
      </div>
      <Card h="single" className="flex items-center gap-3 !bg-brand/5"><QrCode className="h-10 w-10 shrink-0 text-brand" /><div><p className="text-sm font-bold">{t('Un seul QR code pour tout le restaurant')}</p><p className="text-xs text-muted">{tr('Le client choisit « Sur place » et tape son numéro de table.', 'The customer picks “Dine in” and types the table number.', 'يختار الزبون «في المكان» ويكتب رقم الطاولة.')}</p></div></Card>
    </Admin>
  </Over>
);

// ---- Online, promos, allergens, booking, customers, wizard
const Online = () => (
  <Over><Admin active="online" title={t('Commande en ligne')}>
    <div className="space-y-2">
      <Row h="toggle"><span>{tr('Commandes en ligne', 'Online orders', 'الطلبات عبر الإنترنت')}</span><Chip on>ON</Chip></Row>
      <Row h="delivery"><span>{tr('Livraison : frais 10 MAD · minimum 60 MAD', 'Delivery: fee 10 MAD · minimum 60 MAD', 'التوصيل: 10 درهم · أدنى 60 درهم')}</span><Chip>{tr('Zone', 'Zone', 'المنطقة')}</Chip></Row>
      <Row h="hours"><span>{tr('Horaires : 11:00 – 23:00', 'Hours: 11:00 – 23:00', 'الأوقات: 11:00 – 23:00')}</span><Chip>{t('Modifier')}</Chip></Row>
    </div>
  </Admin></Over>
);
const Promos = () => (
  <Over><Admin active="promos" title={t('Promotions')} right={<Btn h="new"><Plus className="h-3.5 w-3.5" />{tr('Nouvelle promotion', 'New promotion', 'عرض جديد')}</Btn>}>
    <div className="space-y-2">
      <Row h="code"><span dir="ltr">BIENVENUE10</span><span className="text-muted">−10 % · {tr('min. 80 MAD', 'min. 80 MAD', 'أدنى 80 درهم')}</span></Row>
      <Row h="happy"><span>Happy hour 17:00 – 19:00</span><span className="text-muted">−20 %</span></Row>
    </div>
  </Admin></Over>
);
const Allergens = () => (
  <Over><Admin active="allergens" title={t('Allergènes')}>
    <div className="space-y-2">
      {[['Tajine poulet', ['Gluten']], [tr('Pastilla', 'Pastilla', 'بسطيلة'), ['Gluten', tr('Œufs', 'Eggs', 'بيض'), tr('Amandes', 'Almonds', 'لوز')]], ['Cappuccino', [tr('Lait', 'Milk', 'حليب')]]].map(([n, a], i) => (
        <Row key={i} h={i === 1 ? 'chips' : undefined}><span>{n as string}</span><span className="flex gap-1.5">{(a as string[]).map(x => <Chip key={x} on>{x}</Chip>)}</span></Row>
      ))}
    </div>
  </Admin></Over>
);
const Booking = () => (
  <Over><Admin active="booking" title={t('Réservations')}>
    <div className="mb-2.5 grid grid-cols-3 gap-2"><Field h="slots" label={tr('Créneaux', 'Time slots', 'الفترات')} value="12:00 – 22:00" /><Field h="cap" label={tr('Capacité', 'Capacity', 'السعة')} value="40" /><Field h="deposit" label={tr('Acompte', 'Deposit', 'العربون')} value="50 MAD" /></div>
    <Row h="inbox"><span>{tr('Demande · 4 pers. · 20:00 · Salma', 'Request · 4 guests · 20:00 · Salma', 'طلب · 4 أشخاص · 20:00 · سلمى')}</span><Btn h="confirm">{tr('Confirmer', 'Confirm', 'تأكيد')}</Btn></Row>
  </Admin></Over>
);
const Customers = () => (
  <Over><Admin active="customers" title={t('Clients')}>
    <div className="space-y-2">
      <Row h="points"><span>Salma · 06 •• •• 12</span><span className="text-brand">120 pts</span></Row>
      <Row h="credit"><span>Karim</span><span className="text-muted">{tr('Ardoise : plafond 500 MAD', 'Tab: limit 500 MAD', 'الدَّين: السقف 500 درهم')}</span></Row>
      <Row><span>Nadia</span><span className="text-brand">45 pts</span></Row>
    </div>
  </Admin></Over>
);
const Wizard = () => (
  <Over><div className="h-full rounded-xl bg-bg p-6"><div className="mx-auto max-w-[440px]">
    <p className="mb-1 text-xs font-bold uppercase tracking-widest text-brand">{tr('Bienvenue', 'Welcome', 'مرحبًا')}</p>
    <h2 className="mb-4 font-display text-xl font-semibold">{tr('Créons votre restaurant', 'Let’s create your restaurant', 'لننشئ مطعمك')}</h2>
    <div className="grid grid-cols-2 gap-2.5">
      <Field h="name" label={tr('Nom du restaurant', 'Restaurant name', 'اسم المطعم')} value="Chez Salma" />
      <Field label={tr('Ville', 'City', 'المدينة')} value="Rabat" />
      <Field h="slug" label={tr('Adresse de votre menu', 'Your menu address', 'عنوان قائمتك')} value={<span dir="ltr">…/chez-salma</span>} className="col-span-2" />
      <Field h="tables" label={tr('Nombre de tables', 'Number of tables', 'عدد الطاولات')} value="12" />
      <Field h="pin" label={tr('Votre code personnel', 'Your personal code', 'رمزك الشخصي')} value={<span dir="ltr" className="tracking-[0.3em]">• • • •</span>} />
    </div>
    <div className="mt-4 flex justify-end"><Btn>{tr('Créer', 'Create', 'إنشاء')}</Btn></div>
  </div></div></Over>
);

const d = (render: () => React.ReactNode): ScreenDef => ({ w: W, h: H, render });
export const ADMIN_SCREENS: Record<string, ScreenDef> = {
  devices: d(() => <Devices />), 'devices-code': d(() => <Devices modal />),
  staff: d(() => <Staff />), 'staff-form': d(() => <Staff modal />),
  menu: d(() => <MenuP />), 'menu-cat': d(() => <MenuCat />), 'menu-item': d(() => <MenuItem />), 'menu-mods': d(() => <MenuMods />), 'menu-import': d(() => <MenuImport />),
  tables: d(() => <Tables />), online: d(() => <Online />), promos: d(() => <Promos />), allergens: d(() => <Allergens />),
  booking: d(() => <Booking />), customers: d(() => <Customers />), wizard: { w: 600, h: 330, render: () => <Wizard /> },
};
