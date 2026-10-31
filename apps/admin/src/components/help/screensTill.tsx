import type { ReactNode } from 'react';
import { Btn, Chip, Field, Till, tr, type ScreenDef } from './kit';

const W = 760, H = 440;
const M = (n: string) => n + ' MAD';
const Line = ({ n, p, q = 1 }: { n: string; p: number; q?: number }) => (
  <div className="flex items-center justify-between py-1 text-[13px] font-semibold"><span>{q} × {n}</span><span className="tabular">{M(String(p * q))}</span></div>
);
const Box = ({ children, h, className = '' }: { children?: ReactNode; h?: string; className?: string }) =>
  <div data-h={h} className={`rounded-2xl bg-surface p-3 ring-1 ring-line/10 ${className}`}>{children}</div>;

const Login = () => (
  <Till>
    <div className="grid h-full grid-cols-2 gap-4">
      <div>
        <p className="mb-2 text-sm font-bold">{tr('Qui êtes-vous ?', 'Who are you?', 'من أنت؟')}</p>
        <div data-h="staff" className="grid grid-cols-2 gap-2">
          {['Youssef', 'Salma', 'Karim', 'Nadia'].map((n, i) => <div key={n} className={`rounded-2xl py-4 text-center text-sm font-bold ring-1 ring-line/10 ${i === 1 ? 'gold-fill text-brand-ink' : 'bg-surface'}`}>{n}</div>)}
        </div>
        <div className="mt-3 flex gap-2"><Btn h="clock" tone="soft">{tr('Pointer arrivée / départ', 'Clock in / out', 'تسجيل الحضور / الانصراف')}</Btn><Btn h="switch" tone="soft">{tr('Changer d’employé', 'Switch staff', 'تغيير الموظف')}</Btn></div>
      </div>
      <div data-h="pad" className="mx-auto w-[220px]">
        <div className="mb-3 flex justify-center gap-3" dir="ltr">{[1, 2, 3, 4].map(i => <i key={i} className={`h-3.5 w-3.5 rounded-full ${i < 3 ? 'bg-brand' : 'bg-surface-3'}`} />)}</div>
        <div className="grid grid-cols-3 gap-2" dir="ltr">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => <div key={i} className={`grid h-11 place-items-center rounded-xl text-lg font-bold ${k ? 'bg-surface ring-1 ring-line/10' : ''}`}>{k}</div>)}</div>
      </div>
    </div>
  </Till>
);

const Tbl = ({ n, c, label, h, x, y }: { n: number; c: string; label: string; h?: string; x: number; y: number }) => (
  <div data-h={h} className={`absolute grid h-[74px] w-[92px] place-items-center rounded-2xl text-center ring-2 ${c}`} style={{ insetInlineStart: x, top: y }}>
    <div><p className="text-base font-extrabold">{n}</p><p className="text-[10.5px] font-bold leading-tight">{label}</p></div>
  </div>
);
const Floor = () => (
  <Till tab={0}>
    <div className="mb-2 flex items-center justify-between"><div className="flex gap-2 text-[11px] font-bold">
      <span className="text-ok">● {tr('Libre', 'Free', 'فارغة')}</span><span className="text-warn">● {tr('Occupée', 'Busy', 'مشغولة')}</span><span className="text-qr">● {tr('À accepter', 'To accept', 'للقبول')}</span></div>
      <div className="flex gap-2"><Btn tone="soft">{tr('Nouvelle commande à emporter', 'New takeaway order', 'طلب جديد للأخذ')}</Btn><Btn h="edit" tone="soft">{tr('Dessiner le plan', 'Edit the plan', 'رسم المخطط')}</Btn></div></div>
    <div className="relative h-[300px] rounded-2xl bg-surface-2">
      <Tbl n={1} h="free" c="bg-ok/10 ring-ok text-ok" label={tr('Libre', 'Free', 'فارغة')} x={30} y={24} />
      <Tbl n={2} h="busy" c="bg-warn/10 ring-warn text-warn" label="24 min" x={160} y={24} />
      <Tbl n={3} h="ready" c="bg-brand/15 ring-brand text-brand" label={tr('Plat prêt à servir', 'Dish ready to serve', 'طبق جاهز للتقديم')} x={290} y={24} />
      <Tbl n={4} h="accept" c="bg-qr/10 ring-qr text-qr" label={tr('À accepter', 'To accept', 'للقبول')} x={420} y={24} />
      <Tbl n={5} c="bg-surface ring-line/20 text-muted" label={tr('Réservée 20:00', 'Booked 20:00', 'محجوزة 20:00')} x={550} y={24} />
      <div className="absolute bottom-3 start-4 rounded-lg bg-surface-3 px-6 py-1.5 text-[11px] font-bold text-muted">{tr('Bar', 'Bar', 'البار')}</div>
    </div>
  </Till>
);

const Order = () => (
  <Till tab={0}>
    <div className="grid h-full grid-cols-[1fr_250px] gap-3">
      <div className="grid grid-cols-3 content-start gap-2 self-start" data-h="items">
        {[['Café', 12], [tr('Thé menthe', 'Mint tea', 'أتاي'), 12], ['Tajine', 65], ['Pizza', 55], [tr('Jus orange', 'Orange juice', 'عصير'), 20], [tr('Gâteau', 'Cake', 'حلوى'), 30]].map(([n, p]) => (
          <div key={n as string} className="rounded-2xl bg-surface p-3 ring-1 ring-line/10"><p className="text-sm font-bold">{n}</p><p className="text-xs text-muted">{M(String(p))}</p></div>
        ))}
      </div>
      <Box className="flex flex-col">
        <p className="mb-1 text-sm font-extrabold">{tr('Table 2', 'Table 2', 'الطاولة 2')}</p>
        <Line n={tr('Café', 'Coffee', 'قهوة')} p={12} q={2} /><Line n="Tajine" p={65} />
        <div data-h="note" className="my-2 rounded-lg border border-line/15 px-2 py-1.5 text-xs text-muted">{tr('Allergie, demande particulière…', 'Allergy, special request…', 'حساسية، طلب خاص…')}</div>
        <div className="mt-auto space-y-1.5">
          <div className="flex gap-1.5"><Btn h="disc" tone="soft" className="flex-1">{tr('Remise', 'Discount', 'خصم')}</Btn><Btn h="move" tone="soft" className="flex-1">{tr('Changer table', 'Move table', 'تغيير الطاولة')}</Btn></div>
          <Btn h="send" className="w-full">{tr('Envoyer en cuisine', 'Send to kitchen', 'إرسال إلى المطبخ')}</Btn>
          <Btn h="pay" tone="dark" className="w-full">{tr('Encaisser', 'Pay', 'تحصيل')} · 89 MAD</Btn>
        </div>
      </Box>
    </div>
  </Till>
);

const QrOrder = () => (
  <Till tab={1}>
    <div data-h="pause" className="mb-2 inline-flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-1.5 text-xs font-bold text-warn">⏸ {tr('Pause 15 min', 'Pause 15 min', 'إيقاف 15 د')}</div>
    <Box className="max-w-[460px]">
      <p className="mb-1 text-sm font-extrabold text-qr">{tr('Commande client (QR) à accepter', 'Customer order (QR) to accept', 'طلب زبون (QR) للقبول')}</p>
      <Line n="Pizza" p={55} /><Line n={tr('Jus orange', 'Orange juice', 'عصير')} p={20} />
      <div className="mt-2 flex gap-2"><Btn h="accept">{tr('Accepter', 'Accept', 'قبول')}</Btn><Btn tone="danger">{tr('Annuler', 'Cancel', 'إلغاء')}</Btn></div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line/10 pt-3">
        <Btn h="wa" tone="soft">💬 {tr('Confirmer au client sur WhatsApp', 'Confirm to customer on WhatsApp', 'تأكيد للزبون عبر واتساب')}</Btn>
        <Btn h="courier" tone="soft">🛵 {tr('Choisir le livreur', 'Choose the courier', 'اختيار الموزّع')}</Btn>
      </div>
    </Box>
  </Till>
);

const Pay = () => (
  <Till tab={0}>
    <div className="grid h-full grid-cols-[210px_1fr] gap-3">
      <Box><p className="text-xs font-bold text-muted">{tr('À payer', 'To pay', 'المبلغ')}</p><p className="font-display text-3xl font-bold tabular">148,00</p><p className="text-xs text-muted">MAD TTC</p></Box>
      <div>
        <div data-h="methods" className="mb-3 flex flex-wrap gap-2">{[tr('Espèces', 'Cash', 'نقدًا'), tr('Carte', 'Card', 'بطاقة'), tr('Mixte', 'Split', 'مختلط'), tr('Virement', 'Transfer', 'تحويل'), tr('Ardoise', 'Tab', 'دَّين')].map((m, i) => <Chip key={m} on={i === 0}>{m}</Chip>)}</div>
        <div data-h="cash" className="mb-3 grid grid-cols-2 gap-2"><Field label={tr('Montant reçu', 'Amount received', 'المبلغ المستلم')} value="200" /><Field label={tr('À rendre', 'Change due', 'المتبقي للزبون')} value={<b className="text-brand">52,00</b>} /></div>
        <div data-h="ice" className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs font-bold">☐ {tr('Facture avec ICE', 'Invoice with ICE', 'فاتورة مع ICE')}</div>
        <Btn h="ok" className="w-full !py-3 text-base">{tr('Valider', 'Confirm', 'تأكيد')}</Btn>
      </div>
    </div>
  </Till>
);

const Split = () => (
  <Till tab={0}>
    <div data-h="modes" className="mb-3 flex gap-2"><Chip on>{tr('Parts égales', 'Equal shares', 'حصص متساوية')}</Chip><Chip>{tr('Par article', 'By item', 'حسب الصنف')}</Chip></div>
    <p className="mb-2 text-sm font-bold">{tr('3 personnes · 49,33 MAD chacune', '3 people · 49.33 MAD each', '3 أشخاص · 49,33 درهم للفرد')}</p>
    <div className="max-w-[420px] space-y-2">{[1, 2, 3].map(i => <Box key={i} className="flex items-center justify-between !py-2"><span className="text-sm font-bold">{tr('Personne', 'Person', 'الشخص')} {i}</span><Btn h={i === 1 ? 'part' : undefined}>{tr('Encaisser cette part', 'Collect this share', 'تحصيل هذه الحصة')}</Btn></Box>)}</div>
  </Till>
);

const Manager = () => (
  <Till tab={0}>
    <div className="mx-auto mt-4 w-[380px] rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-line/10">
      <p className="mb-2 font-display text-base font-semibold">{tr('Validation manager', 'Manager approval', 'مصادقة المدير')}</p>
      <Field h="reason" label={tr('Motif (obligatoire)', 'Reason (required)', 'السبب (إجباري)')} value={tr('Client mécontent', 'Unhappy customer', 'زبون غير راضٍ')} className="mb-2" />
      <div data-h="total" className="mb-2 flex justify-between rounded-lg bg-brand/10 px-3 py-2 text-sm font-bold"><span>−10 %</span><span>134,10 MAD</span></div>
      <Field h="pin" label={tr('Code du manager', 'Manager code', 'رمز المدير')} value={<span dir="ltr" className="tracking-[0.3em]">• • • •</span>} className="mb-3" />
      <div className="flex justify-end"><Btn h="ok">{tr('Valider', 'Confirm', 'تأكيد')}</Btn></div>
    </div>
  </Till>
);

const History = () => (
  <Till tab={2}>
    <div className="grid h-full grid-cols-[1fr_250px] gap-3">
      <div data-h="list" className="space-y-1.5">{[['#0412', '13:05', '148,00'], ['#0411', '12:48', '65,00'], ['#0410', '12:31', '32,00']].map(([n, h, p], i) => <Box key={n} className={`flex justify-between !py-2 text-[13px] font-bold ${i === 0 ? '!ring-brand' : ''}`}><span>{n} · {h} · Salma</span><span>{p} MAD</span></Box>)}</div>
      <Box><p className="mb-2 text-sm font-extrabold">#0412</p><Line n="Tajine" p={65} q={2} /><Line n="Café" p={9} q={2} />
        <div className="mt-3 space-y-1.5"><Btn h="dup" tone="soft" className="w-full">{tr('Duplicata', 'Duplicate', 'نسخة')}</Btn><Btn h="credit" tone="danger" className="w-full">{tr('Avoir (remboursement)', 'Credit note (refund)', 'إشعار دائن (استرجاع)')}</Btn></div></Box>
    </div>
  </Till>
);

const Reports = () => (
  <Till tab={3}>
    <div className="grid h-full grid-cols-[1fr_250px] gap-3">
      <Box h="totals"><p className="text-xs font-bold text-muted">{tr('Chiffre d’affaires du jour', 'Today’s sales', 'مبيعات اليوم')}</p><p className="mb-3 font-display text-3xl font-bold tabular">3 420 MAD</p>
        {[[tr('Espèces', 'Cash', 'نقدًا'), 62], [tr('Carte', 'Card', 'بطاقة'), 31], [tr('Ardoise', 'Tab', 'دَّين'), 7]].map(([n, p]) => <div key={n as string} className="mb-1.5"><div className="mb-0.5 flex justify-between text-xs font-bold"><span>{n}</span><span>{p} %</span></div><div className="h-2 rounded-full bg-surface-3"><div className="h-2 rounded-full bg-brand" style={{ width: p + '%' }} /></div></div>)}
      </Box>
      <div className="space-y-2"><Btn h="out" tone="soft" className="w-full">{tr('Sortie de caisse', 'Cash out', 'إخراج من الصندوق')}</Btn><Btn tone="soft" className="w-full">{tr('Ouvrir le tiroir', 'Open the drawer', 'فتح الدرج')}</Btn><Btn h="z" tone="dark" className="w-full !py-3">{tr('Clôturer la journée (Z)', 'Close the day (Z)', 'إغلاق اليوم (Z)')}</Btn></div>
    </div>
  </Till>
);

const Kitchen = () => (
  <Till>
    <div className="grid grid-cols-3 gap-3">
      {[2, 5, 7].map(n => (
        <Box key={n} className="!p-2.5"><p className="mb-1 text-sm font-extrabold">{tr('Table', 'Table', 'الطاولة')} {n} <span className="text-xs font-bold text-muted">· 6 min</span></p>
          <p className="text-[13px] font-semibold">1 × Tajine</p><p className="text-[13px] font-semibold">2 × Pizza</p>
          {n === 2 && <p data-h="allergy" className="mt-1 rounded-lg bg-danger/10 px-2 py-1 text-xs font-bold text-danger">⚠ {tr('Allergie : arachides', 'Allergy: peanuts', 'حساسية: فول سوداني')}</p>}
          <div className="mt-2 flex gap-1.5"><Btn h={n === 2 ? 'ready' : undefined} className="flex-1">{tr('Prêt', 'Ready', 'جاهز')}</Btn><Btn h={n === 2 ? 'served' : undefined} tone="soft" className="flex-1">{tr('Servi', 'Served', 'قُدِّم')}</Btn></div></Box>
      ))}
    </div>
  </Till>
);

const Offline = () => (
  <Till tab={0}>
    <div data-h="banner" className="mb-3 rounded-xl bg-warn/15 px-3 py-2 text-sm font-bold text-warn">📡 {tr('Hors ligne — vous pouvez continuer à travailler', 'Offline — you can keep working', 'بدون إنترنت — يمكنك متابعة العمل')}</div>
    <div className="grid grid-cols-2 gap-3">
      <Box className="opacity-60"><Line n="Tajine" p={65} /><Line n="Café" p={12} q={2} /></Box>
      <Box h="sync"><p className="mb-1 text-sm font-extrabold">{tr('Synchronisation', 'Synchronisation', 'المزامنة')}</p><p className="text-[13px] font-semibold text-warn">{tr('3 opérations en attente', '3 operations waiting', '3 عمليات في الانتظار')}</p><p className="mt-2 text-[13px] font-semibold text-ok">✓ {tr('Connecté : tout est envoyé.', 'Connected: everything is sent.', 'متصل: تم إرسال كل شيء.')}</p></Box>
    </div>
  </Till>
);

const s = (render: () => ReactNode): ScreenDef => ({ w: W, h: H, render });
export const TILL_SCREENS: Record<string, ScreenDef> = {
  'till-login': s(() => <Login />), 'till-floor': s(() => <Floor />), 'till-order': s(() => <Order />), 'till-qr': s(() => <QrOrder />), 'till-pay': s(() => <Pay />),
  'till-split': s(() => <Split />), 'till-manager': s(() => <Manager />), 'till-history': s(() => <History />), 'till-reports': s(() => <Reports />), 'till-kitchen': s(() => <Kitchen />), 'till-offline': s(() => <Offline />),
};
