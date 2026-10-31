// Contenu du guide intégré (page « Aide »), en français, anglais et arabe.
// Un article = un écran reproduit (components/help/screens*.tsx) + des étapes. Chaque étape désigne un élément (data-h) de l'écran.
// Pour ajouter un article : l'ajouter à ARTICLES avec `a(...)`, avec ses étapes `st(écran, élément, fr, en, ar)`.
// `products` (optionnel) : l'article n'apparaît que si le restaurant a l'un de ces produits (pos, profit, orders, loyalty, agenda).

import { NAV_FR } from '../components/help/kit';

export type L3 = [string, string, string];

/** Une étape de la visite guidée dans la VRAIE application (bouton « Voir dans l'application ») */
export interface TourStep {
  /** page de l'espace de gestion à ouvrir avant l'étape (ex. 'devices', 'menu', 'tables', 'staff') */
  page?: string;
  /** texte visible de l'élément à entourer (en français : il est traduit automatiquement) */
  target?: string;
  /** true = l'élément est dans le menu de gauche */
  nav?: boolean;
  text: string;
}

/** Une étape de la démo : sur quel écran reproduit (s), quel élément entourer (f), et le texte en fr / en / ar */
export interface HelpStep { s: string; f: string; x: L3 }

export interface Article {
  id: string;
  chapter: string;
  icon: string;
  title: L3;
  summary: L3;
  /** mots de recherche dans toutes les langues (synonymes, termes arabes/anglais, fautes courantes) */
  kw: string;
  steps: HelpStep[];
  tip?: L3;
  warn?: L3;
  products?: string[];
}
export interface Chapter { id: string; icon: string; title: L3; blurb: L3 }

const st = (s: string, f: string, fr: string, en: string, ar: string): HelpStep => ({ s, f, x: [fr, en, ar] });
const l3 = (fr: string, en: string, ar: string): L3 => [fr, en, ar];

export const CHAPTERS: Chapter[] = [
  { id: 'start', icon: '🚀', title: l3('Premiers pas', 'Getting started', 'البداية'), blurb: l3('Créer votre restaurant, relier la caisse, ajouter vos employés.', 'Create your restaurant, link your till, add your staff.', 'أنشئ مطعمك، اربط الصندوق، وأضف موظفيك.') },
  { id: 'till', icon: '🧾', title: l3('La caisse', 'The till', 'الصندوق'), blurb: l3('Tables, commandes, encaissement, remises, rapports et clôture.', 'Tables, orders, payments, discounts, reports and closing.', 'الطاولات والطلبات والتحصيل والخصومات والتقارير والإغلاق.') },
  { id: 'menu', icon: '🍽️', title: l3('Le menu et les tables', 'Menu and tables', 'القائمة والطاولات'), blurb: l3('Catégories, articles, options, import, tables et QR codes.', 'Categories, items, options, import, tables and QR codes.', 'الفئات والأصناف والخيارات والاستيراد والطاولات ورموز QR.') },
  { id: 'guest', icon: '📱', title: l3('L’application de vos clients', 'Your customers’ app', 'تطبيق زبنائك'), blurb: l3('Ce que voient vos clients : menu QR, commande, suivi, réservation, club.', 'What your customers see: QR menu, ordering, tracking, booking, club.', 'ما يراه زبناؤك: قائمة QR والطلب والتتبع والحجز والنادي.') },
];

const a = (x: Article): Article => x;

export const ARTICLES: Article[] = [
  // ───────────── Premiers pas
  a({
    id: 'start-create', chapter: 'start', icon: '🏪',
    title: l3('Créer votre restaurant', 'Create your restaurant', 'إنشاء مطعمك'),
    summary: l3('L’assistant de démarrage, en 4 informations.', 'The setup wizard, in 4 details.', 'معالج البداية في 4 معلومات.'),
    kw: 'inscription compte démarrer assistant essai gratuit adresse lien sign up account trial wizard free تسجيل حساب تجربة مجانية',
    steps: [
      st('wizard', 'name', 'Entrez le nom de votre restaurant et votre ville.', 'Enter your restaurant’s name and your city.', 'اكتب اسم مطعمك ومدينتك.'),
      st('wizard', 'slug', 'Choisissez l’adresse de votre menu : c’est le lien que vos clients ouvrent en scannant le QR code.', 'Choose your menu address: it is the link your customers open when they scan the QR code.', 'اختر عنوان قائمتك: هو الرابط الذي يفتحه زبناؤك عند مسح رمز QR.'),
      st('wizard', 'tables', 'Indiquez le nombre de tables. Mettez 0 si vous faites uniquement de l’emporter.', 'Enter the number of tables. Use 0 if you only do takeaway.', 'حدّد عدد الطاولات. ضع 0 إذا كنت تبيع للأخذ فقط.'),
      st('wizard', 'pin', 'Choisissez votre code personnel (4 à 6 chiffres). Il valide remises, annulations et clôture : gardez-le pour vous.', 'Choose your personal code (4–6 digits). It approves discounts, cancellations and closing: keep it to yourself.', 'اختر رمزك الشخصي (4 إلى 6 أرقام). به تُصادَق الخصومات والإلغاءات والإغلاق: احتفظ به لنفسك.'),
    ],
    tip: l3('14 jours d’essai gratuit, sans engagement.', '14-day free trial, no commitment.', 'تجربة مجانية لمدة 14 يومًا، بدون التزام.'),
  }),
  a({
    id: 'start-menu', chapter: 'start', icon: '📋',
    title: l3('Préparer votre menu', 'Prepare your menu', 'تجهيز قائمتك'),
    summary: l3('Trois façons de démarrer : importer, catégories, ou tout saisir.', 'Three ways to start: import, categories, or enter everything.', 'ثلاث طرق للبدء: الاستيراد أو الفئات أو الإدخال اليدوي.'),
    kw: 'menu importer import excel photo pdf catégories articles prix plats categories items prices dishes قائمة استيراد أطباق أسعار',
    steps: [
      st('menu', 'nav-menu', 'Ouvrez « Menu » dans le menu de gauche.', 'Open “Menu” in the left-hand menu.', 'افتح صفحة «القائمة» من القائمة الجانبية.'),
      st('menu', 'import', 'Le plus rapide : « Importer mon menu ». Photo, PDF ou Excel : vos plats et prix sont créés pour vous.', 'Fastest: “Import my menu”. Photo, PDF or Excel — your dishes and prices are created for you.', 'الأسرع: «استيراد قائمتي». صورة أو PDF أو Excel وتُنشأ أطباقك وأسعارك تلقائيًا.'),
      st('menu', 'add-cat', 'Ou partez de zéro : créez d’abord vos catégories (Boissons, Plats…).', 'Or start from scratch: create your categories first (Drinks, Mains…).', 'أو ابدأ من الصفر: أنشئ فئاتك أولًا (مشروبات، أطباق…).'),
      st('menu', 'add-item', 'Puis ajoutez vos articles un par un, avec nom, prix et photo.', 'Then add your items one by one, with name, price and photo.', 'ثم أضف أصنافك واحدًا واحدًا بالاسم والثمن والصورة.'),
    ],
    tip: l3('Tout se modifie ensuite : noms, prix, photos, catégories.', 'Everything can be changed later: names, prices, photos, categories.', 'يمكن تعديل كل شيء لاحقًا: الأسماء والأسعار والصور والفئات.'),
  }),
  a({
    id: 'start-pair', chapter: 'start', icon: '🔗', products: ['pos'],
    title: l3('Relier votre caisse', 'Link your till', 'ربط الصندوق'),
    summary: l3('Un code à usage unique, pas de mot de passe à retenir.', 'A one-time code, no password to remember.', 'رمز لمرة واحدة، لا كلمة سر لتحفظها.'),
    kw: 'caisse relier connecter code qr tablette ordinateur chrome installer android appareil till register connect tablet pair device صندوق ربط جهاز لوحة',
    steps: [
      st('devices', 'nav-devices', 'Ouvrez « Caisses » dans le menu de gauche.', 'Open “Tills” in the left-hand menu.', 'افتح صفحة «الصناديق» من القائمة الجانبية.'),
      st('devices', 'link', 'Touchez « Relier une caisse » : un code à usage unique apparaît.', 'Tap “Link a till”: a one-time code appears.', 'اضغط «ربط صندوق»: يظهر رمز لمرة واحدة.'),
      st('devices-code', 'code', 'Sur la caisse (tablette ou ordinateur, dans Chrome), tapez ce code ou scannez le QR code. Il vaut quelques minutes et ne sert qu’une fois.', 'On the till (tablet or computer, in Chrome), type this code or scan the QR code. It is valid for a few minutes and works once.', 'على الصندوق (لوحة أو حاسوب، في Chrome) اكتب هذا الرمز أو امسح رمز QR. صالح لدقائق ويُستعمل مرة واحدة.'),
      st('devices', 'apk', 'Sur une tablette Android, vous pouvez aussi installer l’application Amplify Caisse (facultatif). Si « Application inconnue » s’affiche : Installer quand même.', 'On an Android tablet you can also install the Amplify Caisse app (optional). If “Unknown app” appears: Install anyway.', 'على لوحة أندرويد يمكنك أيضًا تثبيت تطبيق Amplify Caisse (اختياري). إذا ظهرت «تطبيق غير معروف»: ثبّته على أي حال.'),
    ],
    warn: l3('La formule Essentiel inclut 1 caisse. Pour en relier d’autres, passez à la formule Restaurant. Pour remplacer une caisse, retirez d’abord l’ancienne.', 'The Essential plan includes 1 till. To link more, upgrade to the Restaurant plan. To replace a till, remove the old one first.', 'تتضمن باقة Essentiel صندوقًا واحدًا. لربط المزيد انتقل إلى باقة Restaurant. لاستبدال صندوق أزل القديم أولًا.'),
  }),
  a({
    id: 'start-lost', chapter: 'start', icon: '🔒', products: ['pos'],
    title: l3('Appareil perdu ou volé', 'Lost or stolen device', 'جهاز ضائع أو مسروق'),
    summary: l3('Retirez l’appareil : il perd l’accès tout de suite.', 'Remove the device: it loses access immediately.', 'أزل الجهاز: يفقد الوصول فورًا.'),
    kw: 'perdu volé retirer sécurité accès remplacer lost stolen remove security access revoke ضائع مسروق إزالة أمان',
    steps: [
      st('devices', 'nav-devices', 'Ouvrez « Caisses » dans le menu de gauche.', 'Open “Tills” in the left-hand menu.', 'افتح صفحة «الصناديق» من القائمة الجانبية.'),
      st('devices', 'remove', 'Touchez « Retirer » à côté de l’appareil perdu : il perd l’accès immédiatement.', 'Tap “Remove” next to the lost device: it loses access immediately.', 'اضغط «إزالة» بجانب الجهاز الضائع: يفقد الوصول فورًا.'),
      st('devices', 'link', 'Reliez ensuite un nouvel appareil avec un nouveau code.', 'Then link a new device with a new code.', 'ثم اربط جهازًا جديدًا برمز جديد.'),
    ],
  }),
  a({
    id: 'start-staff', chapter: 'start', icon: '👥', products: ['pos', 'loyalty'],
    title: l3('Ajouter vos employés', 'Add your staff', 'إضافة موظفيك'),
    summary: l3('Chacun choisit son prénom sur la caisse et tape son code.', 'Everyone picks their name on the till and types their code.', 'يختار كل موظف اسمه على الصندوق ويكتب رمزه.'),
    kw: 'employé personnel serveur code pin prénom manager équipe staff server waiter employee team موظف عامل نادل رمز',
    steps: [
      st('staff', 'nav-staff', 'Ouvrez « Personnel » dans le menu de gauche.', 'Open “Staff” in the left-hand menu.', 'افتح صفحة «الموظفون» من القائمة الجانبية.'),
      st('staff', 'add', 'Touchez « Ajouter » pour créer un employé.', 'Tap “Add” to create a staff member.', 'اضغط «إضافة» لإنشاء موظف.'),
      st('staff-form', 'name', 'Entrez le prénom : c’est celui qui s’affiche sur la caisse.', 'Enter the first name: it is the one shown on the till.', 'اكتب الاسم الأول: هو الذي يظهر على الصندوق.'),
      st('staff-form', 'role', 'Choisissez le rôle. Les managers valident remises, annulations, avoirs et clôture Z.', 'Choose the role. Managers approve discounts, cancellations, credit notes and the Z closing.', 'اختر الدور. المديرون يصادقون على الخصومات والإلغاءات وإشعارات الدائن وإغلاق Z.'),
      st('staff-form', 'code', 'Donnez-lui un code de 4 à 6 chiffres. Évitez 1234, 0000 et les dates de naissance.', 'Give them a 4–6 digit code. Avoid 1234, 0000 and birthdays.', 'أعطه رمزًا من 4 إلى 6 أرقام. تجنّب 1234 و0000 وتواريخ الميلاد.'),
    ],
  }),

  // ───────────── La caisse
  a({
    id: 'till-login', chapter: 'till', icon: '🔑', products: ['pos'],
    title: l3('Se connecter et pointer', 'Sign in and clock in', 'تسجيل الدخول والحضور'),
    summary: l3('Chacun choisit son prénom, tape son code et peut pointer.', 'Pick your name, type your code, and clock in.', 'اختر اسمك، اكتب رمزك، وسجّل حضورك.'),
    kw: 'connexion code pin employé serveur pointage arrivée départ changer verrouiller heures login sign in clock shift lock دخول رمز حضور انصراف',
    steps: [
      st('till-login', 'staff', 'Sur l’écran d’accueil de la caisse, chacun touche son prénom.', 'On the till’s home screen, everyone taps their first name.', 'في الشاشة الرئيسية للصندوق، يضغط كل شخص على اسمه.'),
      st('till-login', 'pad', 'Puis il tape son code personnel. Si le code est faux, un message s’affiche : recommencez.', 'Then types their personal code. If it is wrong, a message appears: try again.', 'ثم يكتب رمزه الشخصي. إذا كان الرمز خاطئًا تظهر رسالة: أعد المحاولة.'),
      st('till-login', 'clock', '« Pointer arrivée / départ » enregistre vos heures de travail.', '“Clock in / out” records your working hours.', '«تسجيل الحضور / الانصراف» يسجّل ساعات عملك.'),
      st('till-login', 'switch', '« Changer d’employé » verrouille le poste : le suivant tape son code.', '“Switch staff” locks the till: the next person types their code.', '«تغيير الموظف» يقفل الصندوق: يكتب الموظف التالي رمزه.'),
    ],
    warn: l3('La première connexion d’un employé sur un poste, et le pointage, demandent internet.', 'An employee’s first sign-in on a till, and clocking in, need internet.', 'أول دخول للموظف على صندوق، وتسجيل الحضور، يتطلبان الإنترنت.'),
  }),
  a({
    id: 'till-tables', chapter: 'till', icon: '🪑', products: ['pos'],
    title: l3('Les tables et le plan de salle', 'Tables and floor plan', 'الطاولات ومخطط القاعة'),
    summary: l3('Voir d’un coup d’œil les tables libres, occupées ou à servir.', 'See at a glance which tables are free, busy or ready.', 'شاهد بنظرة واحدة الطاولات الفارغة والمشغولة والجاهزة.'),
    kw: 'tables plan salle libre occupée réservée emporter livraison dessiner terrasse statut floor plan free busy booked draw طاولة مخطط قاعة فارغة مشغولة',
    steps: [
      st('till-floor', 'free', 'Une table libre est prête à recevoir une commande.', 'A free table is ready for an order.', 'الطاولة الفارغة جاهزة لاستقبال طلب.'),
      st('till-floor', 'busy', 'Occupée : une commande est en cours, avec le temps écoulé en minutes.', 'Busy: an order is open, with the elapsed time in minutes.', 'مشغولة: هناك طلب جارٍ مع الوقت المنقضي بالدقائق.'),
      st('till-floor', 'ready', 'Plat prêt à servir : la cuisine a terminé.', 'Dish ready to serve: the kitchen is done.', 'طبق جاهز للتقديم: المطبخ أنهى التحضير.'),
      st('till-floor', 'accept', 'À accepter : un client a commandé par QR code, vous devez valider sa commande.', 'To accept: a customer ordered by QR code and you must approve the order.', 'للقبول: زبون طلب عبر رمز QR وعليك المصادقة على طلبه.'),
      st('till-floor', 'edit', '« Dessiner le plan » : placez les tables comme dans votre salle, puis « C’est fait ».', '“Edit the plan”: place the tables like in your room, then “Done”.', '«رسم المخطط»: ضع الطاولات كما في قاعتك ثم «تم».'),
    ],
    tip: l3('Les tables elles-mêmes (noms, nombre, zones, QR codes) se créent dans l’espace de gestion, page « Tables & QR codes ».', 'The tables themselves (names, number, zones, QR codes) are created in the back office, “Tables & QR codes” page.', 'تُنشأ الطاولات نفسها (الأسماء والعدد والمناطق ورموز QR) في صفحة «الطاولات ورموز QR» بلوحة التسيير.'),
  }),
  a({
    id: 'till-order', chapter: 'till', icon: '📝', products: ['pos'],
    title: l3('Prendre une commande', 'Take an order', 'أخذ طلب'),
    summary: l3('Ajouter des articles, préciser pour la cuisine, envoyer.', 'Add items, add details for the kitchen, send.', 'أضف الأصناف، وأضف ملاحظات للمطبخ، ثم أرسل.'),
    kw: 'commande ajouter article précision allergie envoyer cuisine suite service changer de table regrouper order add item note allergy kitchen send move طلب إضافة صنف حساسية مطبخ',
    steps: [
      st('till-floor', 'free', 'Touchez une table libre (ou « Nouvelle commande à emporter »).', 'Tap a free table (or “New takeaway order”).', 'اضغط على طاولة فارغة (أو «طلب جديد للأخذ»).'),
      st('till-order', 'items', 'Touchez les articles à ajouter. S’il y a des options ou des tailles, choisissez-les.', 'Tap the items to add. If there are options or sizes, choose them.', 'اضغط على الأصناف المراد إضافتها. إن وُجدت خيارات أو أحجام فاخترها.'),
      st('till-order', 'note', 'Ajoutez une précision (allergie, demande particulière) : elle apparaît sur le bon de cuisine.', 'Add a note (allergy, special request): it appears on the kitchen ticket.', 'أضف ملاحظة (حساسية، طلب خاص): تظهر على بون المطبخ.'),
      st('till-order', 'send', 'Touchez « Envoyer en cuisine ». Pour un repas par services, envoyez l’entrée d’abord, puis « Envoyer la suite ».', 'Tap “Send to kitchen”. For a multi-course meal, send the starter first, then “Send next course”.', 'اضغط «إرسال إلى المطبخ». لوجبة بالأطوار أرسل المقبلات أولًا ثم «إرسال التالي».'),
      st('till-order', 'move', '« Changer table » déplace la commande. Si la table est occupée, les deux additions sont regroupées.', '“Move table” moves the order. If the table is busy, the two bills are merged.', '«تغيير الطاولة» ينقل الطلب. إذا كانت الطاولة مشغولة تُدمج الفاتورتان.'),
    ],
  }),
  a({
    id: 'till-qr', chapter: 'till', icon: '📲', products: ['pos', 'orders'],
    title: l3('Commandes des clients (QR) et en ligne', 'Customer (QR) and online orders', 'طلبات الزبناء (QR) وعبر الإنترنت'),
    summary: l3('Accepter les commandes que vos clients passent eux-mêmes.', 'Accept the orders your customers place themselves.', 'اقبل الطلبات التي يرسلها زبناؤك بأنفسهم.'),
    kw: 'qr accepter en ligne pause whatsapp livreur livraison prête emporter code de livraison accept online delivery courier takeaway طلب قبول توصيل موزع واتساب',
    steps: [
      st('till-qr', 'accept', 'Un client a commandé par QR code : touchez « Accepter » (ou « Annuler »).', 'A customer ordered by QR code: tap “Accept” (or “Cancel”).', 'زبون طلب عبر رمز QR: اضغط «قبول» (أو «إلغاء»).'),
      st('till-qr', 'wa', 'À emporter ou livraison : indiquez le délai, puis « Confirmer au client sur WhatsApp » : le message est prêt à envoyer.', 'Takeaway or delivery: set the preparation time, then “Confirm to customer on WhatsApp”: the message is ready to send.', 'للأخذ أو التوصيل: حدّد مدة التحضير ثم «تأكيد للزبون عبر واتساب»: الرسالة جاهزة للإرسال.'),
      st('till-qr', 'courier', 'Livraison : « Choisir le livreur », puis envoyez-lui la course sur WhatsApp. Le code de livraison s’échange contre la commande.', 'Delivery: “Choose the courier”, then send them the job on WhatsApp. The delivery code is exchanged for the order.', 'التوصيل: «اختيار الموزّع» ثم أرسل له المهمة عبر واتساب. يُسلَّم الطلب مقابل رمز التسليم.'),
      st('till-qr', 'pause', 'Débordé ? « Pause 15 min » suspend les commandes en ligne ; « Reprendre » les rouvre tout de suite.', 'Swamped? “Pause 15 min” suspends online orders; “Resume” reopens them right away.', 'مضغوط؟ «إيقاف 15 د» يوقف الطلبات عبر الإنترنت؛ و«استئناف» يعيد فتحها فورًا.'),
    ],
  }),
  a({
    id: 'till-pay', chapter: 'till', icon: '💳', products: ['pos'],
    title: l3('Encaisser', 'Take payment', 'التحصيل'),
    summary: l3('Espèces, carte, mixte, virement ou ardoise.', 'Cash, card, split, transfer or tab.', 'نقدًا أو بطاقة أو مختلط أو تحويل أو دَّين.'),
    kw: 'encaisser payer espèces carte tpe mixte virement ardoise pourboire monnaie facture ice acompte ticket addition reçu pay cash card change invoice tip receipt دفع نقد بطاقة فاتورة',
    steps: [
      st('till-order', 'pay', 'Ouvrez la commande et touchez « Encaisser ».', 'Open the order and tap “Pay”.', 'افتح الطلب واضغط «تحصيل».'),
      st('till-pay', 'methods', 'Choisissez le moyen de paiement : espèces, carte, mixte, virement ou ardoise (le client doit être associé).', 'Choose the payment method: cash, card, split, transfer or tab (the customer must be linked).', 'اختر طريقة الدفع: نقدًا أو بطاقة أو مختلط أو تحويل أو دَّين (يجب ربط الزبون).'),
      st('till-pay', 'cash', 'En espèces, tapez le montant reçu : la caisse affiche la monnaie à rendre.', 'For cash, type the amount received: the till shows the change due.', 'عند الدفع نقدًا اكتب المبلغ المستلم: يعرض الصندوق المتبقي للزبون.'),
      st('till-pay', 'ice', 'Facture pour un professionnel : cochez « Facture avec ICE », puis saisissez la raison sociale et l’ICE (15 chiffres).', 'Invoice for a business: tick “Invoice with ICE”, then enter the company name and ICE number (15 digits).', 'فاتورة لمهني: فعّل «فاتورة مع ICE» ثم أدخل اسم الشركة ورقم ICE (15 رقمًا).'),
      st('till-pay', 'ok', 'Validez : le ticket fiscal est émis et s’imprime.', 'Confirm: the fiscal receipt is issued and printed.', 'أكّد: تُصدر التذكرة الضريبية وتُطبع.'),
    ],
    tip: l3('Sans internet, vous pouvez encaisser : le ticket fiscal est émis au retour de la connexion.', 'Without internet you can still take payment: the fiscal receipt is issued when the connection returns.', 'بدون إنترنت يمكنك التحصيل: تُصدر التذكرة الضريبية عند عودة الاتصال.'),
  }),
  a({
    id: 'till-split', chapter: 'till', icon: '➗', products: ['pos'],
    title: l3('Partager l’addition', 'Split the bill', 'تقسيم الفاتورة'),
    summary: l3('En parts égales, ou chacun paie ses articles.', 'Equal shares, or everyone pays for their own items.', 'حصص متساوية أو يدفع كل شخص أصنافه.'),
    kw: 'partager diviser séparer parts égales chacun personnes addition split share divide bill تقسيم فاتورة حصص',
    steps: [
      st('till-split', 'modes', 'Choisissez : parts égales (arrondi au dirham, le dernier paie le reste) ou par article.', 'Choose: equal shares (rounded to the dirham, the last person pays the rest) or by item.', 'اختر: حصص متساوية (تُقرَّب إلى الدرهم ويدفع الأخير الباقي) أو حسب الصنف.'),
      st('till-split', 'part', 'Touchez « Encaisser cette part » pour chaque personne : chacune reçoit son ticket. À la fin, la table se libère.', 'Tap “Collect this share” for each person: each gets their own receipt. At the end the table is freed.', 'اضغط «تحصيل هذه الحصة» لكل شخص: يتسلّم كل واحد تذكرته. في النهاية تُحرَّر الطاولة.'),
    ],
    warn: l3('Si une remise est appliquée à l’addition, partagez avant la remise, ou encaissez le total.', 'If a discount is applied to the bill, split before the discount, or take the total.', 'إذا طُبّق خصم على الفاتورة فقسّم قبل الخصم أو حصّل المجموع.'),
  }),
  a({
    id: 'till-discount', chapter: 'till', icon: '🏷️', products: ['pos'],
    title: l3('Remises, annulations et validation manager', 'Discounts, cancellations and manager approval', 'الخصومات والإلغاءات ومصادقة المدير'),
    summary: l3('Les actions sensibles demandent un motif et le code d’un manager.', 'Sensitive actions need a reason and a manager’s code.', 'الإجراءات الحساسة تتطلب سببًا ورمز المدير.'),
    kw: 'remise réduction annuler annulation offert motif manager code promo fidélité cagnotte supprimer discount cancel void reason approval خصم إلغاء سبب مدير',
    steps: [
      st('till-order', 'disc', 'Touchez « Remise » (ou « Annuler la commande »).', 'Tap “Discount” (or “Cancel the order”).', 'اضغط «خصم» (أو «إلغاء الطلب»).'),
      st('till-manager', 'reason', 'Saisissez le motif : il est obligatoire.', 'Enter the reason: it is required.', 'اكتب السبب: إجباري.'),
      st('till-manager', 'total', 'La caisse affiche le nouveau total avant de confirmer.', 'The till shows the new total before you confirm.', 'يعرض الصندوق المجموع الجديد قبل التأكيد.'),
      st('till-manager', 'pin', 'Un manager tape son code pour valider.', 'A manager types their code to approve.', 'يكتب المدير رمزه للمصادقة.'),
      st('till-manager', 'ok', 'Validez. Même règle pour retirer un article déjà envoyé en cuisine (internet requis).', 'Confirm. Same rule to remove an item already sent to the kitchen (internet required).', 'أكّد. القاعدة نفسها لحذف صنف أُرسل إلى المطبخ (يتطلب الإنترنت).'),
    ],
  }),
  a({
    id: 'till-history', chapter: 'till', icon: '🗂️', products: ['pos'],
    title: l3('Historique, duplicata et avoir', 'History, duplicate and credit note', 'السجل والنسخة وإشعار الدائن'),
    summary: l3('Retrouver un ticket, le réimprimer ou le rembourser.', 'Find a receipt, reprint it or refund it.', 'ابحث عن تذكرة، أعد طباعتها أو استرجع مبلغها.'),
    kw: 'historique ticket duplicata réimprimer avoir remboursement rembourser erreur corriger history receipt reprint refund credit note سجل تذكرة نسخة استرجاع',
    steps: [
      st('till-history', 'list', 'L’onglet « Historique » liste les tickets du jour. Touchez-en un.', 'The “History” tab lists today’s receipts. Tap one.', 'تعرض لسانة «السجل» تذاكر اليوم. اضغط على إحداها.'),
      st('till-history', 'dup', '« Duplicata » le réimprime.', '“Duplicate” reprints it.', '«نسخة» تعيد طباعتها.'),
      st('till-history', 'credit', '« Avoir (remboursement) » annule le ticket : motif obligatoire, validation d’un manager, puis remboursez avec le même moyen de paiement.', '“Credit note (refund)” cancels the receipt: reason required, manager approval, then refund using the same payment method.', '«إشعار دائن (استرجاع)» يلغي التذكرة: سبب إجباري ومصادقة مدير، ثم أرجع المبلغ بنفس طريقة الدفع.'),
    ],
    warn: l3('Un ticket émis ne se modifie jamais : toute correction passe par un avoir.', 'An issued receipt is never edited: every correction goes through a credit note.', 'التذكرة الصادرة لا تُعدَّل أبدًا: كل تصحيح يمرّ عبر إشعار دائن.'),
  }),
  a({
    id: 'till-reports', chapter: 'till', icon: '📊', products: ['pos'],
    title: l3('Rapport X, caisse et clôture (Z)', 'X report, cash and closing (Z)', 'تقرير X والصندوق والإغلاق (Z)'),
    summary: l3('Suivre le chiffre du jour, gérer l’argent en caisse, clôturer.', 'Follow the day’s sales, manage the cash, close the day.', 'تابع مبيعات اليوم، دبّر النقد، وأغلق اليوم.'),
    kw: 'rapport x z clôture clôturer fond de caisse espèces sortie tiroir ardoises chiffre d’affaires comptage journée report closing cash drawer sales end of day إغلاق تقرير مبيعات صندوق',
    steps: [
      st('till-reports', 'totals', '« Caisse & rapports » montre le chiffre du jour et la répartition par moyen de paiement.', '“Till & reports” shows the day’s sales and the split by payment method.', 'تعرض «الصندوق والتقارير» مبيعات اليوم وتوزيعها حسب طريقة الدفع.'),
      st('till-reports', 'out', '« Sortie de caisse » : un retrait (courses…) avec son motif. Il réduit les espèces attendues, pas le chiffre d’affaires.', '“Cash out”: a withdrawal (shopping…) with its reason. It lowers the expected cash, not the sales.', '«إخراج من الصندوق»: سحب (مشتريات…) مع سببه. يخفض النقد المتوقع لا المبيعات.'),
      st('till-reports', 'z', '« Clôturer la journée (Z) » : comptez les espèces, saisissez le montant, validez. Le rapport Z s’imprime.', '“Close the day (Z)”: count the cash, enter the amount, confirm. The Z report prints.', '«إغلاق اليوم (Z)»: عُدّ النقد وأدخل المبلغ وأكّد. يُطبع تقرير Z.'),
    ],
    warn: l3('La clôture est définitive. Encaissez ou annulez d’abord toutes les commandes ouvertes.', 'Closing is final. First pay or cancel every open order.', 'الإغلاق نهائي. حصّل أو ألغِ أولًا كل الطلبات المفتوحة.'),
    tip: l3('Oubli hier ? La caisse vous le rappelle en rouge.', 'Forgot yesterday? The till reminds you in red.', 'نسيت أمس؟ يذكّرك الصندوق باللون الأحمر.'),
  }),
  a({
    id: 'till-kitchen', chapter: 'till', icon: '👨‍🍳', products: ['pos'],
    title: l3('L’écran cuisine', 'The kitchen screen', 'شاشة المطبخ'),
    summary: l3('Un poste qui affiche les bons à préparer.', 'A screen that shows the tickets to prepare.', 'شاشة تعرض البونات المطلوب تحضيرها.'),
    kw: 'cuisine écran bon prêt servi rappeler passe station bar imprimante ticket kitchen screen ready served printer مطبخ شاشة جاهز',
    steps: [
      st('till-kitchen', 'allergy', 'L’écran cuisine affiche les bons à préparer ; allergies et notes sont mises en évidence.', 'The kitchen screen shows the tickets to prepare; allergies and notes stand out.', 'تعرض شاشة المطبخ البونات المطلوبة؛ وتبرز الحساسية والملاحظات.'),
      st('till-kitchen', 'ready', 'Touchez « Prêt » quand le plat est terminé.', 'Tap “Ready” when the dish is done.', 'اضغط «جاهز» عند انتهاء الطبق.'),
      st('till-kitchen', 'served', 'Puis « Servi » quand il a été servi. « Rappeler » ramène un bon touché par erreur.', 'Then “Served” once it has been served. “Recall” brings back a ticket cleared by mistake.', 'ثم «قُدِّم» بعد تقديمه. «استدعاء» يعيد بونًا أُغلق بالخطأ.'),
    ],
    tip: l3('Le poste « passe » montre toutes les stations. Les imprimantes se choisissent dans Réglages du poste.', 'The “pass” screen shows every station. Printers are chosen in the till’s settings.', 'شاشة «الممر» تعرض كل المحطات. تُختار الطابعات من إعدادات الصندوق.'),
  }),
  a({
    id: 'till-offline', chapter: 'till', icon: '📡', products: ['pos'],
    title: l3('Travailler sans internet', 'Working without internet', 'العمل بدون إنترنت'),
    summary: l3('La caisse continue et envoie tout au retour de la connexion.', 'The till keeps working and sends everything when the connection returns.', 'يواصل الصندوق العمل ويرسل كل شيء عند عودة الاتصال.'),
    kw: 'hors ligne offline internet connexion coupure synchronisation wifi panne envoi sync outage بدون إنترنت انقطاع مزامنة',
    steps: [
      st('till-offline', 'banner', 'Sans internet, « Hors ligne » s’affiche : continuez à prendre des commandes, imprimer et encaisser.', 'Without internet, “Offline” appears: keep taking orders, printing and taking payments.', 'عند انقطاع الإنترنت تظهر «بدون إنترنت»: واصل أخذ الطلبات والطباعة والتحصيل.'),
      st('till-offline', 'sync', 'Au retour de la connexion, ouvrez « Synchronisation » : quand tout est parti, « Connecté : tout est envoyé ».', 'When the connection is back, open “Synchronisation”: once everything is sent, “Connected: everything is sent”.', 'عند عودة الاتصال افتح «المزامنة»: عند إرسال كل شيء يظهر «متصل: تم إرسال كل شيء».'),
    ],
    warn: l3('Ne videz pas le navigateur tant que des opérations sont en attente : elles seraient perdues.', 'Do not clear the browser while operations are waiting: they would be lost.', 'لا تمسح بيانات المتصفح ما دامت هناك عمليات في الانتظار: ستضيع.'),
  }),

  // ───────────── Le menu et les tables
  a({
    id: 'menu-categories', chapter: 'menu', icon: '🗂️',
    title: l3('Les catégories', 'Categories', 'الفئات'),
    summary: l3('Organiser la carte, choisir l’imprimante et les services.', 'Organise your menu, pick the printer and the courses.', 'نظّم قائمتك واختر الطابعة والأطوار.'),
    kw: 'catégorie boissons plats ordre monter descendre masquer imprimante préparé à service suite entrée emporter icône category drinks order printer course فئة مشروبات ترتيب طابعة',
    steps: [
      st('menu', 'add-cat', '« Ajouter » crée une catégorie (Boissons, Plats…). Les flèches « Monter » et « Descendre » les réordonnent.', '“Add” creates a category (Drinks, Mains…). The up and down arrows reorder them.', '«إضافة» تنشئ فئة (مشروبات، أطباق…). وتعيد الأسهم ترتيبها.'),
      st('menu-cat', 'printer', '« Préparé à » : sur quelle imprimante part le bon (cuisine, bar…).', '“Prepared at”: which printer the ticket goes to (kitchen, bar…).', '«يُحضَّر في»: الطابعة التي يُرسل إليها البون (المطبخ، البار…).'),
      st('menu-cat', 'service', '« Service » : les plats d’un service suivant attendent à la caisse, on les envoie avec « Envoyer la suite ».', '“Course”: dishes of a later course wait at the till and are sent with “Send next course”.', '«الطور»: أطباق الطور اللاحق تنتظر في الصندوق وتُرسل بـ«إرسال التالي».'),
      st('menu-cat', 'takeaway', '« À emporter : moins cher de » réduit chaque article de la catégorie quand la commande est à emporter. 0 = même prix.', '“Takeaway: cheaper by” lowers every item of the category for takeaway orders. 0 = same price.', '«للأخذ: أرخص بـ» يخفّض ثمن كل صنف في الفئة عند الطلب للأخذ. 0 = نفس الثمن.'),
    ],
    tip: l3('Décochez « Visible » pour masquer toute la catégorie du menu et de la caisse.', 'Untick “Visible” to hide the whole category from the menu and the till.', 'ألغِ «ظاهر» لإخفاء الفئة كلها من القائمة والصندوق.'),
  }),
  a({
    id: 'menu-items', chapter: 'menu', icon: '🍰',
    title: l3('Ajouter et modifier un article', 'Add and edit an item', 'إضافة صنف وتعديله'),
    summary: l3('Nom, prix, photo, tailles, vente au poids, code-barres, prix Glovo.', 'Name, price, photo, sizes, sold by weight, barcode, Glovo price.', 'الاسم والثمن والصورة والأحجام والبيع بالوزن والباركود وثمن Glovo.'),
    kw: 'article plat prix photo description taille options glovo poids balance code-barres scanner visible supprimer item dish price size weight barcode scale صنف طبق ثمن صورة وزن باركود',
    steps: [
      st('menu', 'add-item', 'Choisissez une catégorie puis touchez « Ajouter un article ».', 'Pick a category then tap “Add an item”.', 'اختر فئة ثم اضغط «إضافة صنف».'),
      st('menu-item', 'photo', 'Nom, prix et photo : la photo fait toute la différence sur le menu QR.', 'Name, price and photo: the photo makes all the difference on the QR menu.', 'الاسم والثمن والصورة: الصورة تصنع الفرق في قائمة QR.'),
      st('menu-item', 'variants', 'Tailles / options : par exemple S, M, L, chacune avec son prix. Le client doit en choisir une.', 'Sizes / options: for example S, M, L, each with its price. The customer must pick one.', 'الأحجام / الخيارات: مثل S وM وL لكل منها ثمنه. على الزبون اختيار أحدها.'),
      st('menu-item', 'glovo', '« Prix Glovo » : laissé vide, il est calculé automatiquement.', '“Glovo price”: if left empty, it is calculated automatically.', '«ثمن Glovo»: إذا تُرك فارغًا يُحسب تلقائيًا.'),
      st('menu-item', 'weight', '« Vendu au poids » : la caisse demande le poids lu sur la balance. Pas de commande en ligne pour cet article.', '“Sold by weight”: the till asks for the weight read on the scale. No online ordering for this item.', '«يُباع بالوزن»: يطلب الصندوق الوزن المقروء من الميزان. لا طلب عبر الإنترنت لهذا الصنف.'),
      st('menu-item', 'barcode', '« Code-barres » : le scanner de la caisse ajoute l’article (3 à 32 caractères).', '“Barcode”: the till’s scanner adds the item (3 to 32 characters).', '«الباركود»: ماسح الصندوق يضيف الصنف (من 3 إلى 32 رمزًا).'),
    ],
  }),
  a({
    id: 'menu-availability', chapter: 'menu', icon: '🚫',
    title: l3('Épuisé ou masqué : quelle différence ?', 'Sold out or hidden: what’s the difference?', 'نفد أم مخفي: ما الفرق؟'),
    summary: l3('Deux façons de retirer un article, pour deux situations.', 'Two ways to remove an item, for two situations.', 'طريقتان لسحب صنف، لحالتين مختلفتين.'),
    kw: 'épuisé rupture masquer oeil œil disponible afficher stock sold out hide eye available نفد إخفاء متوفر',
    steps: [
      st('menu', 'soldout', '« Épuisé » : l’article reste visible mais n’est plus commandable aujourd’hui. Idéal pour une rupture. Remettez « Disponible » demain.', '“Sold out”: the item stays visible but cannot be ordered today. Ideal for a stock-out. Set it back to “Available” tomorrow.', '«نفد»: يبقى الصنف ظاهرًا لكن لا يمكن طلبه اليوم. مناسب عند نفاد المخزون. أعده «متوفرًا» غدًا.'),
      st('menu', 'eye', 'L’œil masque l’article du menu et de la caisse : pratique pour un plat de saison. « Afficher » le remet.', 'The eye hides the item from the menu and the till: handy for a seasonal dish. “Show” brings it back.', 'العين تخفي الصنف من القائمة والصندوق: مفيدة لطبق موسمي. «إظهار» يعيده.'),
    ],
  }),
  a({
    id: 'menu-modifiers', chapter: 'menu', icon: '➕',
    title: l3('Suppléments et formules', 'Extras and set menus', 'الإضافات والتشكيلات'),
    summary: l3('Des groupes de choix réutilisables (cuisson, sauces, boisson).', 'Reusable groups of choices (cooking, sauces, drink).', 'مجموعات خيارات قابلة لإعادة الاستعمال (الطهي، الصلصات، المشروب).'),
    kw: 'supplément formule option cuisson boisson groupe choix obligatoire fiche technique sauce extra menu enfant extras set menu modifier group إضافة تشكيلة خيار طهي',
    steps: [
      st('menu', 'mods', '« Suppléments et formules » : des groupes de choix réutilisables (cuisson, sauces, boisson de la formule).', '“Extras and set menus”: reusable groups of choices (cooking, sauces, the set menu’s drink).', '«الإضافات والتشكيلات»: مجموعات خيارات قابلة لإعادة الاستعمال (الطهي، الصلصات، مشروب التشكيلة).'),
      st('menu-mods', 'kind', 'Choisissez ce que fait le client : suppléments facultatifs, choix obligatoire ou sur mesure (minimum et maximum).', 'Choose what the customer does: optional extras, a required choice, or custom (minimum and maximum).', 'اختر ما يفعله الزبون: إضافات اختيارية أو اختيار إجباري أو مخصّص (حد أدنى وأقصى).'),
      st('menu-mods', 'opts', 'Ajoutez les options avec leur prix en plus (vide = gratuit).', 'Add the options with their extra price (empty = free).', 'أضف الخيارات مع ثمنها الإضافي (فارغ = مجاني).'),
      st('menu-mods', 'dishes', 'Cochez « Sur quels plats ? » : le groupe est réutilisé partout où vous le cochez.', 'Tick “Which dishes?”: the group is reused everywhere you tick it.', 'حدّد «على أي أطباق؟»: تُعاد استعمال المجموعة في كل مكان تحدّدها فيه.'),
    ],
  }),
  a({
    id: 'menu-import', chapter: 'menu', icon: '📥',
    title: l3('Importer votre carte', 'Import your menu', 'استيراد قائمتك'),
    summary: l3('Photo, PDF ou Excel : votre menu prêt en 2 minutes, annulable.', 'Photo, PDF or Excel: your menu ready in 2 minutes, reversible.', 'صورة أو PDF أو Excel: قائمتك جاهزة في دقيقتين، وقابلة للإلغاء.'),
    kw: 'importer import photo pdf excel csv xls ancienne caisse modèle ia annuler traduction arabe changer de caisse menu upload scan استيراد صورة قائمة إلغاء',
    steps: [
      st('menu', 'import', '« Importer mon menu » : plus besoin de tout retaper.', '“Import my menu”: no need to retype everything.', '«استيراد قائمتي»: لا حاجة لإعادة كتابة كل شيء.'),
      st('menu-import', 'file', 'Choisissez une photo ou un PDF (6 pages maximum), ou un fichier Excel / CSV de votre ancienne caisse.', 'Choose a photo or PDF (6 pages max), or an Excel / CSV file from your old till.', 'اختر صورة أو PDF (6 صفحات كحد أقصى) أو ملف Excel / CSV من صندوقك القديم.'),
      st('menu-import', 'review', 'Vérifiez l’écran de contrôle : prix, catégories, traductions. Décochez les lignes douteuses.', 'Check the review screen: prices, categories, translations. Untick doubtful lines.', 'راجع شاشة التحقق: الأسعار والفئات والترجمات. ألغِ تحديد الأسطر المشكوك فيها.'),
      st('menu-import', 'go', '« Importer … articles » : tout est importé d’un coup. Les plats déjà existants sont ignorés.', '“Import … items”: everything is imported at once. Dishes that already exist are skipped.', '«استيراد … أصناف»: يُستورد كل شيء دفعة واحدة. الأطباق الموجودة تُتجاهل.'),
      st('menu-import', 'undo', 'Une erreur ? « Annuler cet import » : les plats déjà vendus sont masqués plutôt que supprimés.', 'A mistake? “Undo this import”: dishes already sold are hidden rather than deleted.', 'خطأ؟ «إلغاء هذا الاستيراد»: الأطباق التي بيعت تُخفى بدل أن تُحذف.'),
    ],
    warn: l3('Vérifiez toujours les prix lus par l’IA. Photo nette, bien éclairée, de face = meilleurs résultats. Ancien .xls : enregistrez-le en .xlsx ou CSV.', 'Always check the prices read by the AI. A sharp, well-lit, front-on photo works best. Old .xls: save it as .xlsx or CSV.', 'راجع دائمًا الأسعار التي قرأها الذكاء الاصطناعي. صورة واضحة جيدة الإضاءة ومن الأمام تعطي أفضل نتيجة. ملف .xls القديم: احفظه بصيغة .xlsx أو CSV.'),
  }),
  a({
    id: 'menu-tables', chapter: 'menu', icon: '🔳', products: ['pos', 'orders'],
    title: l3('Tables et QR codes', 'Tables and QR codes', 'الطاولات ورموز QR'),
    summary: l3('Créer vos tables, imprimer les QR codes, ou un QR unique.', 'Create your tables, print the QR codes, or use a single QR.', 'أنشئ طاولاتك واطبع رموز QR أو استعمل رمزًا واحدًا.'),
    kw: 'table qr code imprimer zone terrasse salle zip png svg nouveau qr abîmé chevalet plastifier qr unique sur place print sticker طاولة رمز طباعة',
    steps: [
      st('tables', 'add', '« Ajouter des tables » : de quel numéro à quel numéro, avec une zone si vous voulez (Terrasse, Salle).', '“Add tables”: from which number to which, with a zone if you like (Terrace, Dining room).', '«إضافة طاولات»: من أي رقم إلى أي رقم، مع منطقة إن أردت (الشرفة، القاعة).'),
      st('tables', 'print', '« Imprimer tous les QR codes » : 6 par page A4. Collez-les sur les tables, idéalement plastifiés.', '“Print all QR codes”: 6 per A4 page. Stick them on the tables, ideally laminated.', '«طباعة كل رموز QR»: 6 في صفحة A4. الصقها على الطاولات ويفضَّل تغليفها.'),
      st('tables', 'regen', '« Générer un nouveau QR code » si un QR est copié ou abîmé : l’ancien code collé ne fonctionnera plus.', '“Generate a new QR code” if one is copied or damaged: the old one on the table will stop working.', '«إنشاء رمز QR جديد» إذا نُسخ رمز أو تلف: الرمز القديم الملصق لن يعمل.'),
      st('tables', 'single', '« QR code unique » : un seul modèle pour toutes les tables. Le client choisit « Sur place » et tape son numéro de table.', '“Single QR code”: one design for all tables. The customer picks “Dine in” and types the table number.', '«رمز QR واحد»: نموذج واحد لكل الطاولات. يختار الزبون «في المكان» ويكتب رقم طاولته.'),
    ],
  }),

  // ───────────── L'application de vos clients
  a({
    id: 'guest-scan', chapter: 'guest', icon: '📷', products: ['pos', 'orders'],
    title: l3('Ce que voit votre client en scannant', 'What your customer sees when scanning', 'ما يراه زبونك عند المسح'),
    summary: l3('Le menu s’ouvre dans le navigateur : rien à installer.', 'The menu opens in the browser: nothing to install.', 'تُفتح القائمة في المتصفح: لا شيء للتثبيت.'),
    kw: 'client scanner qr menu téléphone langue arabe anglais recherche populaire incontournables application lien customer scan phone language search popular زبون مسح قائمة هاتف لغة',
    steps: [
      st('g-menu', 'lang', 'Le client scanne le QR code : le menu s’ouvre sans application ni compte, en français, anglais ou arabe.', 'The customer scans the QR code: the menu opens with no app or account, in French, English or Arabic.', 'يمسح الزبون رمز QR: تُفتح القائمة دون تطبيق أو حساب، بالفرنسية أو الإنجليزية أو العربية.'),
      st('g-menu', 'search', '« Rechercher un plat » trouve un article en quelques lettres.', '“Search for a dish” finds an item in a few letters.', '«ابحث عن طبق» يجد الصنف ببضعة أحرف.'),
      st('g-menu', 'stars', '« Nos incontournables » met en avant vos plats vedettes ; des étiquettes aident à choisir (Populaire, Nouveau, Épicé…).', '“Our must-tries” highlights your star dishes; labels help to choose (Popular, New, Spicy…).', '«أطباقنا المميزة» تبرز أطباقك النجمة؛ وتساعد الوسوم على الاختيار (شائع، جديد، حار…).'),
      st('g-menu', 'soldout', 'Un article épuisé reste visible mais ne peut pas être commandé.', 'A sold-out item stays visible but cannot be ordered.', 'الصنف الذي نفد يبقى ظاهرًا لكن لا يمكن طلبه.'),
      st('g-menu', 'call', '« Besoin de quelque chose ? » appelle un serveur d’une touche.', '“Need anything?” calls a waiter with one tap.', '«تحتاج شيئًا؟» تستدعي نادلًا بلمسة واحدة.'),
    ],
    tip: l3('Tout vient de la page « Menu » de votre espace : une modification est visible tout de suite.', 'Everything comes from your “Menu” page: a change is visible right away.', 'كل شيء يأتي من صفحة «القائمة»: أي تعديل يظهر فورًا.'),
  }),
  a({
    id: 'guest-order', chapter: 'guest', icon: '🛒', products: ['pos', 'orders'],
    title: l3('Commander depuis son téléphone', 'Ordering from their phone', 'الطلب من الهاتف'),
    summary: l3('Panier, note pour la cuisine, sur place, à emporter ou livraison.', 'Basket, kitchen note, dine in, takeaway or delivery.', 'السلة وملاحظة للمطبخ، في المكان أو للأخذ أو توصيل.'),
    kw: 'commander panier sur place emporter livraison prénom téléphone note cuisine frais minimum zone order basket takeaway delivery fee طلب سلة توصيل للأخذ',
    steps: [
      st('g-cart', 'note', 'Le client ajoute ses articles, ouvre le panier et peut écrire une note pour la cuisine (allergies…).', 'The customer adds items, opens the basket and can write a note for the kitchen (allergies…).', 'يضيف الزبون أصنافه ويفتح السلة ويمكنه كتابة ملاحظة للمطبخ (حساسية…).'),
      st('g-cart', 'mode', 'Il choisit : sur place, à emporter ou livraison. Sur place, la commande est liée à la table du QR code ; le paiement se fait auprès du personnel.', 'He picks: dine in, takeaway or delivery. Dine in, the order is tied to the QR code’s table; payment is made to the staff.', 'يختار: في المكان أو للأخذ أو توصيل. في المكان يُربط الطلب بطاولة رمز QR ويُدفع للعاملين.'),
      st('g-cart', 'order', 'Il indique son prénom puis touche « Commander » : la commande arrive à la caisse, à accepter.', 'He enters his first name then taps “Order”: the order reaches the till, ready to accept.', 'يكتب اسمه ثم يضغط «اطلب»: يصل الطلب إلى الصندوق ليُقبل.'),
      st('online', 'delivery', 'Frais, minimum et zone de livraison, horaires et pause se règlent dans « Commande en ligne ».', 'Delivery fee, minimum and zone, hours and pause are set in “Online ordering”.', 'رسوم التوصيل والحد الأدنى والمنطقة والأوقات والإيقاف تُضبط في «الطلب عبر الإنترنت».'),
    ],
    warn: l3('Si le restaurant est fermé ou en pause, le client est prévenu et peut commander pour plus tard.', 'If the restaurant is closed or paused, the customer is told and can order for later.', 'إذا كان المطعم مغلقًا أو متوقفًا مؤقتًا يُنبَّه الزبون ويمكنه الطلب لوقت لاحق.'),
  }),
  a({
    id: 'guest-track', chapter: 'guest', icon: '⏱️', products: ['pos', 'orders'],
    title: l3('Suivre sa commande', 'Tracking an order', 'تتبع الطلب'),
    summary: l3('Le client voit où en est sa commande, en direct.', 'The customer sees where the order stands, live.', 'يرى الزبون حالة طلبه مباشرة.'),
    kw: 'suivi statut reçue préparation prête servie annulée livreur code de livraison whatsapp attente tracking status ready delivery code تتبع حالة جاهز رمز التسليم',
    steps: [
      st('g-track', 'status', 'Après sa commande, le client suit où elle en est, en direct : reçue, en préparation, prête, servie.', 'After ordering, the customer follows it live: received, being prepared, ready, served.', 'بعد الطلب يتابع الزبون مباشرة: تم الاستلام، قيد التحضير، جاهز، قُدِّم.'),
      st('g-track', 'wa', 'Un bouton lui permet d’écrire au restaurant sur WhatsApp.', 'A button lets him message the restaurant on WhatsApp.', 'يتيح له زر مراسلة المطعم عبر واتساب.'),
      st('g-track', 'code', 'En livraison, un code de livraison est à donner au livreur à la remise de la commande.', 'For delivery, a delivery code is given to the courier when the order is handed over.', 'في التوصيل يُعطى رمز التسليم للموزّع عند تسلّم الطلب.'),
    ],
  }),
  a({
    id: 'guest-promo', chapter: 'guest', icon: '🎟️', products: ['pos'],
    title: l3('Codes promo et happy hour', 'Promo codes and happy hour', 'رموز الخصم والساعة السعيدة'),
    summary: l3('Un code dans le panier ; une happy hour s’affiche toute seule.', 'A code in the basket; a happy hour shows up by itself.', 'رمز في السلة؛ والساعة السعيدة تظهر تلقائيًا.'),
    kw: 'promo code réduction remise happy hour promotion coupon minimum discount voucher خصم عرض رمز ساعة سعيدة',
    steps: [
      st('promos', 'new', '« Nouvelle promotion » : créez un code promo ou une happy hour.', '“New promotion”: create a promo code or a happy hour.', '«عرض جديد»: أنشئ رمز خصم أو ساعة سعيدة.'),
      st('promos', 'code', 'Un code : réduction, minimum de commande, nombre maximum d’utilisations.', 'A code: discount, minimum order, maximum number of uses.', 'الرمز: الخصم والحد الأدنى للطلب وأقصى عدد للاستعمالات.'),
      st('promos', 'happy', 'Une happy hour s’affiche toute seule pendant la période, sans code à saisir.', 'A happy hour shows by itself during its period, with no code to enter.', 'تظهر الساعة السعيدة تلقائيًا خلال فترتها دون إدخال رمز.'),
      st('g-cart', 'promo', 'Côté client : il saisit son code dans le panier et touche « Appliquer ». Un message explique si le code ne marche pas.', 'Customer side: he types his code in the basket and taps “Apply”. A message explains if the code does not work.', 'عند الزبون: يكتب رمزه في السلة ويضغط «تطبيق». توضّح رسالة سبب عدم صلاحية الرمز.'),
    ],
  }),
  a({
    id: 'guest-allergens', chapter: 'guest', icon: '🥜', products: ['pos', 'profit'],
    title: l3('Allergènes sur le menu', 'Allergens on the menu', 'مسببات الحساسية في القائمة'),
    summary: l3('Le client masque les plats qui contiennent son allergène.', 'The customer hides dishes containing their allergen.', 'يخفي الزبون الأطباق التي تحتوي مسبّب حساسيته.'),
    kw: 'allergène allergie gluten arachide lait oeuf traces masquer sécurité intolérance allergen allergy peanut milk egg حساسية غلوتين فول سوداني',
    steps: [
      st('allergens', 'chips', 'Renseignez les allergènes de chaque plat.', 'Fill in the allergens of each dish.', 'سجّل مسبّبات الحساسية لكل طبق.'),
      st('g-allergy', 'chips', 'Le client touche « Une allergie ? » et choisit « Masquer les plats avec » : les plats concernés disparaissent.', 'The customer taps “An allergy?” and picks “Hide dishes containing”: those dishes disappear.', 'يضغط الزبون «حساسية؟» ويختار «إخفاء الأطباق التي تحتوي على»: تختفي الأطباق المعنية.'),
      st('g-allergy', 'all', '« Tout afficher » les remet.', '“Show all” brings them back.', '«إظهار الكل» يعيدها.'),
    ],
    warn: l3('Indicatif : le menu rappelle de prévenir le personnel en cas d’allergie.', 'For guidance only: the menu reminds customers to tell the staff about any allergy.', 'للإرشاد فقط: تذكّر القائمة بإخبار العاملين في حال الحساسية.'),
  }),
  a({
    id: 'guest-booking', chapter: 'guest', icon: '📅', products: ['pos', 'orders'],
    title: l3('Réserver une table et liste d’attente', 'Booking a table and the waiting list', 'حجز طاولة وقائمة الانتظار'),
    summary: l3('Le client réserve en ligne ; vous confirmez.', 'The customer books online; you confirm.', 'يحجز الزبون عبر الإنترنت وأنت تؤكد.'),
    kw: 'réservation réserver table liste d’attente file acompte annuler anniversaire groupe confirmer créneau booking reservation waitlist deposit slot حجز طاولة انتظار عربون',
    steps: [
      st('booking', 'slots', 'Réglez vos créneaux et votre capacité dans « Réservations ».', 'Set your time slots and capacity in “Reservations”.', 'اضبط فتراتك وسعتك في «الحجوزات».'),
      st('booking', 'deposit', 'Option : demandez un acompte, il est déduit de l’addition.', 'Option: ask for a deposit; it is deducted from the bill.', 'اختياري: اطلب عربونًا يُخصم من الفاتورة.'),
      st('g-book', 'when', 'Le client choisit le jour, l’heure et le nombre de personnes.', 'The customer picks the day, the time and the number of guests.', 'يختار الزبون اليوم والساعة وعدد الأشخاص.'),
      st('g-book', 'who', 'Il laisse son prénom et son numéro WhatsApp.', 'He leaves his first name and WhatsApp number.', 'يترك اسمه ورقم واتساب.'),
      st('g-book', 'send', 'Il envoie la demande : vous confirmez ensuite, à la caisse ou dans « Réservations ».', 'He sends the request: you then confirm, at the till or in “Reservations”.', 'يرسل الطلب: ثم تؤكد أنت، في الصندوق أو في «الحجوزات».'),
      st('g-book', 'queue', 'S’il n’y a plus de place, il peut « Rejoindre la file » : la page l’avertit quand sa table est prête.', 'If there is no room left he can “Join the queue”: the page tells him when his table is ready.', 'إذا لم يعد هناك مكان يمكنه «الانضمام إلى الانتظار»: تنبّهه الصفحة عندما تجهز طاولته.'),
    ],
  }),
  a({
    id: 'guest-club', chapter: 'guest', icon: '🎁', products: ['pos', 'loyalty'],
    title: l3('Le club et la carte fidélité', 'The club and loyalty card', 'النادي وبطاقة الولاء'),
    summary: l3('Inscription par QR code, points à chaque visite, récompenses.', 'Sign-up by QR code, points on every visit, rewards.', 'تسجيل برمز QR ونقاط في كل زيارة ومكافآت.'),
    kw: 'club fidélité carte points cagnotte récompense whatsapp inscription offres numéro loyalty card points reward member نادي ولاء بطاقة نقاط مكافأة',
    steps: [
      st('g-club', 'join', 'Un QR code spécial ouvre « Rejoindre le club » : prénom et WhatsApp pour recevoir offres et cadeaux.', 'A special QR code opens “Join the club”: first name and WhatsApp to receive offers and gifts.', 'رمز QR خاص يفتح «انضم إلى النادي»: الاسم وواتساب لتلقّي العروض والهدايا.'),
      st('g-club', 'points', 'Chaque client a sa carte fidélité personnelle : points et cagnotte grandissent à chaque visite.', 'Each customer has a personal loyalty card: points and balance grow with every visit.', 'لكل زبون بطاقة ولاء شخصية: تزداد النقاط والرصيد مع كل زيارة.'),
      st('g-club', 'rewards', 'Il montre ses récompenses au personnel : la remise est déduite de l’addition.', 'He shows his rewards to the staff: the discount is deducted from the bill.', 'يُري العاملين مكافآته: يُخصم التخفيض من الفاتورة.'),
      st('customers', 'points', 'Vous retrouvez vos clients inscrits et leurs points dans « Clients ».', 'You find your registered customers and their points in “Customers”.', 'تجد زبناءك المسجلين ونقاطهم في «الزبناء».'),
    ],
    tip: l3('Conseil au client : « Ajouter à l’écran d’accueil » pour voir ses points en un tap.', 'Tip for the customer: “Add to home screen” to see their points in one tap.', 'نصيحة للزبون: «أضف إلى الشاشة الرئيسية» ليرى نقاطه بلمسة.'),
  }),
  a({
    id: 'guest-story', chapter: 'guest', icon: '📸', products: ['pos'],
    title: l3('Story Instagram, cadeau et avis Google', 'Instagram story, gift and Google review', 'قصة إنستغرام وهدية وتقييم Google'),
    summary: l3('Le client poste une story de son plat et reçoit un cadeau.', 'The customer posts a story of their dish and gets a gift.', 'ينشر الزبون قصة عن طبقه ويحصل على هدية.'),
    kw: 'story instagram partager cadeau code cadeau avis google récompense photo polaroid bon share gift review reward قصة إنستغرام هدية تقييم',
    steps: [
      st('g-story', 'story', 'Après sa commande, le client partage son plat en story Instagram : l’image est préparée pour lui.', 'After ordering, the customer shares his dish as an Instagram story: the image is prepared for him.', 'بعد الطلب ينشر الزبون طبقه كقصة على إنستغرام: الصورة جاهزة له.'),
      st('g-story', 'gift', 'Il reçoit un cadeau à montrer au serveur, ou un code à saisir dans le panier à sa prochaine visite.', 'He gets a gift to show the waiter, or a code to enter in the basket on his next visit.', 'يحصل على هدية يُريها للنادل أو رمز يُدخله في السلة في زيارته القادمة.'),
      st('g-story', 'review', 'Le menu l’invite aussi à laisser un avis Google.', 'The menu also invites him to leave a Google review.', 'تدعوه القائمة أيضًا إلى ترك تقييم على Google.'),
    ],
    tip: l3('Chaque story publiée est de la publicité gratuite pour vous.', 'Every story posted is free advertising for you.', 'كل قصة منشورة هي إعلان مجاني لك.'),
  }),
];

// ───────────── visite guidée dans la vraie application (facultative, écrans de l'espace de gestion uniquement)
const REAL: Record<string, string> = {
  'devices:link': 'Relier une caisse', 'devices:remove': 'Retirer', 'staff:add': 'Ajouter', 'menu:add-cat': 'Ajouter', 'menu:add-item': 'Ajouter un article',
  'menu:mods': 'Suppléments et formules', 'menu:import': 'Importer', 'menu:soldout': 'Épuisé', 'tables:add': 'Ajouter des tables', 'tables:print': 'Imprimer tous les QR codes',
  'tables:single': 'Un seul QR code pour tout le restaurant', 'promos:new': 'Nouvelle promotion',
};
const pageOf = (s: string) => s.replace(/-(code|form|cat|item|mods|import)$/, '');

/** Les étapes de l'article qui ont un équivalent dans la vraie application, avec le texte dans la langue demandée (0 fr, 1 en, 2 ar) */
export function tourFor(art: Article, lang: 0 | 1 | 2): TourStep[] {
  const out: TourStep[] = [];
  for (const s of art.steps) {
    if (s.f.startsWith('nav-')) { const t = NAV_FR[s.f.slice(4)]; if (t) out.push({ target: t, nav: true, text: s.x[lang] }); continue; }
    const target = REAL[`${s.s}:${s.f}`];
    if (target) out.push({ page: pageOf(s.s), target, text: s.x[lang] });
  }
  return out;
}
