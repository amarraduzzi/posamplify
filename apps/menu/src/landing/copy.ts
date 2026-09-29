// Website copy, French and Arabic. Claims stay factual: only what the product does today;
// upcoming features are labelled "Bientôt / قريبا".

export type SiteLang = 'fr' | 'ar';

const fr = {
  nav: { features: 'Fonctionnalités', demo: 'Démo', pricing: 'Tarifs', faq: 'Questions', login: 'Se connecter', cta: 'Essai gratuit' },
  hero: {
    eyebrow: 'Caisse · Menu QR · Gestion',
    title1: 'La caisse qui',
    title2: 'ne s’arrête jamais.',
    sub: 'Caisse tactile, menu QR, bons cuisine et chiffres du jour dans un seul système. Pensé pour les cafés et restaurants du Maroc, en français et en arabe. Et il continue de fonctionner quand internet tombe.',
    cta: 'Essayer 30 jours gratuits',
    demo: 'Voir la démo en direct',
    note: 'Sans carte bancaire. Sans engagement.',
    chips: ['Français · العربية', 'Fonctionne hors ligne', 'Menu QR inclus', 'Tickets numérotés avec ICE'],
  },
  offline: {
    kicker: 'Hors ligne',
    title: 'Coupez internet. Le service continue.',
    text: 'Commandes, bons cuisine et encaissements restent sur la caisse et partent tout seuls au retour de la connexion. Sans doublon, sans rien perdre. Essayez vous-même :',
    internet: 'Internet',
    on: 'Connecté',
    off: 'Coupé',
    queued: 'en attente',
    synced: 'Tout est synchronisé',
    events: ['Table 4 · 2 cafés noirs', 'Bon envoyé au bar', 'Table 7 · Tajine poulet', 'Bon envoyé en cuisine', 'Table 4 · encaissé 32 DH', 'À emporter · 3 msemen'],
  },
  features: {
    kicker: 'Tout en un',
    title: 'Tout ce qu’il faut pour un service sans stress.',
    items: [
      ['Caisse tactile rapide', 'Tables, commandes, remises et encaissement en quelques touches. Chaque serveur entre avec son propre code.'],
      ['Menu QR à table', 'Le client scanne, choisit et commande depuis son téléphone. La commande arrive en caisse avec un signal sonore.'],
      ['Bons cuisine et bar', 'Chaque article part automatiquement vers la bonne imprimante, avec les précisions du client.'],
      ['Chaque dirham contrôlé', 'Remises, annulations et remboursements demandent le code du manager et restent tracés.'],
      ['Tickets numérotés et archivés', 'Numérotation continue, ICE du client, avoirs et archive infalsifiable conservée 10 ans.'],
      ['Clôture en un clic', 'Rapports X et Z, espèces attendues, ventes par employé et export pour le comptable.'],
    ] as [string, string][],
  },
  lang: {
    kicker: 'Deux langues',
    title: 'Chaque employé travaille dans sa langue.',
    text: 'Français ou arabe, au choix de chaque serveur, sur la même caisse. Le menu client s’affiche en français, en arabe et en anglais.',
  },
  live: {
    kicker: 'Démo en direct',
    title: 'Scannez le menu d’un vrai café.',
    text: 'Ouvrez l’appareil photo de votre téléphone et scannez ce code. Vous voyez exactement ce que voient les clients de Dom’s Café à Rabat.',
    open: 'Ouvrir le menu',
  },
  soon: {
    kicker: 'Bientôt',
    title: 'Votre conseiller du soir.',
    text: 'Chaque soir, un résumé clair de votre journée et trois actions pour demain. Calculé sur vos vrais chiffres, expliqué simplement.',
    card: [
      ['Chiffre d’affaires', '8 450 DH', '+12 % vs mardi dernier'],
      ['À vérifier', '3 remises', 'plus que d’habitude sur le service du soir'],
      ['Idée pour demain', 'Tajine poulet', 'se vend 2 fois moins le soir : proposez-le au serveur'],
    ] as [string, string, string][],
    note: 'Exemple d’illustration',
  },
  pricing: {
    kicker: 'Tarifs',
    title: 'Des prix clairs. Pas de surprise.',
    note: '30 jours gratuits sur toutes les formules. Prix hors taxes, par mois et par restaurant. Matériel vendu à part.',
    per: 'DH HT / mois',
    popular: 'Le plus choisi',
    soon: 'Bientôt',
    choose: 'Commencer',
    plans: [
      { name: 'Essentiel', price: '199', text: 'Pour les cafés et snacks.', items: ['1 caisse', 'Menu QR consultation', 'Bons cuisine et bar', 'Rapports X et Z', 'Français et arabe'] },
      { name: 'Restaurant', price: '349', text: 'Pour les restaurants avec service.', items: ['Caisses illimitées', 'Commande QR à table', 'Tables, zones et transferts', 'À emporter, livraison, Glovo', 'Fonctionne hors ligne'] },
      { name: 'Contrôle', price: '599', text: 'Pour piloter les coûts.', items: ['Tout Restaurant', 'Stock et fiches techniques', 'Food cost par plat', 'Briefing du soir'], soon: true },
    ],
  },
  faq: {
    kicker: 'Questions',
    title: 'Les questions qu’on nous pose.',
    items: [
      ['Faut-il acheter du matériel ?', 'Non. Un PC ou une tablette avec Chrome suffit. Pour imprimer, une imprimante ticket standard de 58 ou 80 mm.'],
      ['Et si internet coupe ?', 'La caisse continue : commandes, bons et encaissements. Tout se synchronise automatiquement au retour de la connexion.'],
      ['Y a-t-il un engagement ?', 'Non. Abonnement mensuel, résiliable à tout moment.'],
      ['Mes données m’appartiennent ?', 'Oui. Vous exportez vos ventes quand vous voulez, dans un format lisible par votre comptable.'],
      ['Mon équipe parle arabe, pas français.', 'Chaque employé choisit sa langue sur la caisse. La gestion existe aussi en arabe.'],
    ] as [string, string][],
  },
  final: { title: 'Prêt pour votre prochain service ?', text: 'Créez votre restaurant en 5 minutes. Menu, tables et caisse sont prêts le jour même.', cta: 'Créer mon restaurant' },
  footer: 'Amplify POS, conçu à Rabat par Amplify Growth Studio.',
};

type Copy = typeof fr;

const ar: Copy = {
  nav: { features: 'المميزات', demo: 'عرض مباشر', pricing: 'الأسعار', faq: 'أسئلة', login: 'تسجيل الدخول', cta: 'تجربة مجانية' },
  hero: {
    eyebrow: 'صندوق · قائمة QR · تسيير',
    title1: 'الصندوق الذي',
    title2: 'لا يتوقف أبدا.',
    sub: 'صندوق باللمس، قائمة QR، وصولات المطبخ وأرقام اليوم في نظام واحد. مصمم للمقاهي والمطاعم في المغرب، بالعربية والفرنسية. ويستمر في العمل حتى عند انقطاع الإنترنت.',
    cta: 'جربوه 30 يوما مجانا',
    demo: 'شاهدوا العرض المباشر',
    note: 'بدون بطاقة بنكية. بدون التزام.',
    chips: ['العربية · Français', 'يعمل بدون إنترنت', 'قائمة QR مضمنة', 'تذاكر مرقمة مع ICE'],
  },
  offline: {
    kicker: 'بدون إنترنت',
    title: 'اقطعوا الإنترنت. الخدمة مستمرة.',
    text: 'الطلبات ووصولات المطبخ والتحصيل تبقى في الصندوق وتُرسل تلقائيا عند رجوع الاتصال. بدون تكرار وبدون ضياع أي شيء. جربوا بأنفسكم:',
    internet: 'الإنترنت',
    on: 'متصل',
    off: 'مقطوع',
    queued: 'في الانتظار',
    synced: 'تمت مزامنة كل شيء',
    events: ['طاولة 4 · قهوتان سوداوان', 'أُرسل الوصل إلى البار', 'طاولة 7 · طاجين الدجاج', 'أُرسل الوصل إلى المطبخ', 'طاولة 4 · تم تحصيل 32 درهم', 'للأخذ · 3 مسمن'],
  },
  features: {
    kicker: 'كل شيء في نظام واحد',
    title: 'كل ما تحتاجونه لخدمة بدون ضغط.',
    items: [
      ['صندوق سريع باللمس', 'الطاولات والطلبات والتخفيضات والتحصيل ببضع لمسات. كل نادل يدخل برمزه الخاص.'],
      ['قائمة QR على الطاولة', 'الزبون يمسح الرمز ويختار ويطلب من هاتفه. يصل الطلب إلى الصندوق مع تنبيه صوتي.'],
      ['وصولات المطبخ والبار', 'كل صنف يُرسل تلقائيا إلى الطابعة المناسبة، مع ملاحظات الزبون.'],
      ['مراقبة كل درهم', 'التخفيضات والإلغاءات والاسترجاعات تتطلب رمز المسؤول وتبقى مسجلة.'],
      ['تذاكر مرقمة ومؤرشفة', 'ترقيم متسلسل، ICE الزبون، استرجاعات وأرشيف غير قابل للتزوير يُحفظ 10 سنوات.'],
      ['إغلاق اليوم بنقرة', 'تقارير X و Z، النقد المنتظر، المبيعات حسب الموظف وملف للمحاسب.'],
    ],
  },
  lang: {
    kicker: 'لغتان',
    title: 'كل موظف يعمل بلغته.',
    text: 'العربية أو الفرنسية، حسب اختيار كل نادل، على نفس الصندوق. وقائمة الزبناء بالعربية والفرنسية والإنجليزية.',
  },
  live: {
    kicker: 'عرض مباشر',
    title: 'امسحوا قائمة مقهى حقيقي.',
    text: 'افتحوا كاميرا هاتفكم وامسحوا هذا الرمز. سترون بالضبط ما يراه زبناء Dom’s Café في الرباط.',
    open: 'فتح القائمة',
  },
  soon: {
    kicker: 'قريبا',
    title: 'مستشاركم كل مساء.',
    text: 'كل مساء، ملخص واضح ليومكم وثلاثة إجراءات للغد. محسوب على أرقامكم الحقيقية ومشروح ببساطة.',
    card: [
      ['رقم المعاملات', '8 450 درهم', '+12% مقارنة بالثلاثاء الماضي'],
      ['للتحقق', '3 تخفيضات', 'أكثر من المعتاد في خدمة المساء'],
      ['فكرة للغد', 'طاجين الدجاج', 'يُباع أقل بمرتين في المساء: اقترحوه على النادل'],
    ],
    note: 'مثال توضيحي',
  },
  pricing: {
    kicker: 'الأسعار',
    title: 'أسعار واضحة. بدون مفاجآت.',
    note: '30 يوما مجانا في جميع العروض. الأسعار بدون ضريبة، شهريا ولكل مطعم. المعدات تباع على حدة.',
    per: 'درهم / شهر (بدون ضريبة)',
    popular: 'الأكثر اختيارا',
    soon: 'قريبا',
    choose: 'ابدأوا',
    plans: [
      { name: 'الأساسي', price: '199', text: 'للمقاهي والوجبات السريعة.', items: ['صندوق واحد', 'قائمة QR للاطلاع', 'وصولات المطبخ والبار', 'تقارير X و Z', 'العربية والفرنسية'] },
      { name: 'المطعم', price: '349', text: 'للمطاعم مع الخدمة.', items: ['صناديق غير محدودة', 'الطلب بـ QR على الطاولة', 'الطاولات والمناطق والنقل', 'للأخذ، التوصيل، Glovo', 'يعمل بدون إنترنت'] },
      { name: 'المراقبة', price: '599', text: 'للتحكم في التكاليف.', items: ['كل عرض المطعم', 'المخزون والبطاقات التقنية', 'تكلفة كل طبق', 'ملخص المساء'], soon: true },
    ],
  },
  faq: {
    kicker: 'أسئلة',
    title: 'الأسئلة التي تُطرح علينا.',
    items: [
      ['هل يجب شراء معدات؟', 'لا. يكفي حاسوب أو لوحة إلكترونية مع متصفح Chrome. للطباعة، طابعة تذاكر عادية 58 أو 80 ملم.'],
      ['وإذا انقطع الإنترنت؟', 'الصندوق يستمر: الطلبات والوصولات والتحصيل. وتتم المزامنة تلقائيا عند رجوع الاتصال.'],
      ['هل هناك التزام؟', 'لا. اشتراك شهري يمكن إلغاؤه في أي وقت.'],
      ['هل بياناتي ملكي؟', 'نعم. تصدرون مبيعاتكم متى شئتم، بصيغة يقرؤها محاسبكم.'],
      ['فريقي يتحدث العربية وليس الفرنسية.', 'كل موظف يختار لغته على الصندوق. والتسيير متوفر أيضا بالعربية.'],
    ],
  },
  final: { title: 'مستعدون لخدمتكم القادمة؟', text: 'أنشئوا مطعمكم في 5 دقائق. القائمة والطاولات والصندوق جاهزة في نفس اليوم.', cta: 'إنشاء مطعمي' },
  footer: 'Amplify POS، صُمم في الرباط من طرف Amplify Growth Studio.',
};

export const COPY: Record<SiteLang, Copy> = { fr, ar };
