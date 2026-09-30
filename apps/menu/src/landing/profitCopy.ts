// Texts of the Amplify Profit page (posamplify.pages.dev/profit), French and Arabic.
import type { SiteLang } from './copy';

const fr = {
  title: 'Amplify Profit · Les marges de votre restaurant, plat par plat',
  nav: { pos: 'Amplify POS', how: 'Comment ça marche', pricing: 'Tarifs', faq: 'Questions', login: 'Se connecter', cta: 'Essai gratuit' },
  hero: {
    kicker: 'Amplify Profit',
    title1: 'Vous vendez beaucoup.',
    title2: 'Mais combien vous gagnez ?',
    text: 'Amplify Profit calcule ce que coûte chaque plat, ce qu’il vous rapporte vraiment, et quel prix demander. Avec votre caisse actuelle, quelle qu’elle soit.',
    cta: 'Essayer 30 jours gratuits',
    cta2: 'Comment ça marche',
    note: 'Sans carte bancaire. Sans changer de caisse.',
  },
  card: {
    label: 'Fiche technique',
    dish: 'Tajine poulet citron',
    lines: [['Poulet fermier', '300 g', '24,00'], ['Citron confit', '50 g', '0,40'], ['Olives', '30 g', '1,20'], ['Oignons, épices, huile', '', '2,60']] as [string, string, string][],
    cost: 'Coût matière', price: 'Prix de vente', fc: 'Food cost', margin: 'Marge',
    alert: 'Poulet +15 % cette semaine : food cost du tajine 32,7 % → 36,8 %',
    example: 'Exemple d’illustration',
  },
  pains: {
    kicker: 'Le problème',
    title: 'Le chiffre d’affaires ne dit pas tout.',
    items: [
      ['Vos achats changent chaque semaine', 'Poulet, huile, tomates : les prix bougent, vos prix de vente restent les mêmes. La marge fond sans que vous le voyiez.'],
      ['Certains plats vous font perdre de l’argent', 'Les plats les plus vendus ne sont pas toujours ceux qui rapportent le plus. Sans fiche technique, impossible de savoir.'],
      ['Tout est dans votre tête ou sur un cahier', 'Et les calculs prennent des heures. Alors on ne les fait pas.'],
    ] as [string, string][],
  },
  features: {
    kicker: 'Ce que vous obtenez',
    title: 'Un contrôleur de gestion dans votre poche.',
    ready: 'Disponible', soon: 'Bientôt',
    items: [
      ['Fiches techniques en 2 minutes', 'L’IA remplit la recette standard de chaque plat avec les quantités habituelles au Maroc. Vous ajustez.', true],
      ['Food cost et marge par plat', 'En vert, orange ou rouge. Vous voyez tout de suite quel plat revoir.', true],
      ['Prix conseillé', 'Le prix de vente qui respecte votre objectif de marge, arrondi au dirham.', true],
      ['Votre carte importée en photo', 'Une photo de votre menu ou un fichier Excel : vos plats sont créés automatiquement.', true],
      ['Factures fournisseurs en photo', 'Même les bons écrits à la main du souk. Les prix se mettent à jour et vous êtes alerté.', false],
      ['Stock et écarts', 'Comptez en 10 minutes. Voyez ce qui manque, en kilos et en dirhams.', false],
      ['Loyer, salaires, point mort', 'Le chiffre à faire chaque jour pour être rentable.', false],
      ['Personnel', 'Heures, coût du personnel en % du chiffre d’affaires, remises et annulations par employé.', false],
    ] as [string, string, boolean][],
  },
  how: {
    kicker: 'Comment ça marche',
    title: 'Aucun changement de caisse.',
    text: 'Amplify Profit fonctionne seul, avec votre caisse actuelle. Avec Amplify POS, les ventes arrivent toutes seules.',
    steps: [
      ['Photo de votre carte', 'L’IA lit vos plats et vos prix. En 2 minutes votre menu est prêt.'],
      ['L’IA remplit les fiches', 'Recette standard et prix d’achat estimés. Vous mettez vos vrais prix au fil de vos achats.'],
      ['Vous voyez vos marges', 'Plat par plat, avec le prix conseillé pour ceux qui ne rapportent pas assez.'],
    ] as [string, string][],
    together: 'Avec Amplify POS : les ventes de la caisse donnent votre marge réelle du mois, sans rien saisir.',
  },
  pricing: {
    kicker: 'Tarifs',
    title: 'Un seul bon plat mal calculé coûte plus cher.',
    per: 'DH HT / mois',
    note: '30 jours gratuits. Sans engagement. Prix hors taxes, par restaurant.',
    alone: { name: 'Amplify Profit', text: 'Avec votre caisse actuelle.', items: ['Fiches techniques par l’IA', 'Food cost, marge et prix conseillé', 'Import de votre carte en photo', 'Français et arabe'] },
    both: { name: 'Contrôle', tag: 'POS + Profit', text: 'La caisse et les marges ensemble.', items: ['Tout Amplify Profit', 'Caisse, tables et menu QR', 'Marges réelles depuis les ventes', 'Briefing du soir avec l’IA'] },
    choose: 'Commencer', best: 'Le plus complet',
  },
  faq: {
    kicker: 'Questions',
    title: 'Les questions qu’on nous pose.',
    items: [
      ['Dois-je changer de caisse ?', 'Non. Amplify Profit fonctionne seul. Vous importez votre carte en photo ou en Excel, et vous gardez votre caisse.'],
      ['Les prix de l’IA sont-ils justes ?', 'Ce sont des estimations du marché marocain, marquées « estimé ». Vous les remplacez par vos vrais prix d’achat, et les marges deviennent exactes.'],
      ['Mes prix d’achat sont-ils visibles par mon équipe ?', 'Non. Seuls le propriétaire et les managers voient les coûts. Jamais la caisse ni les serveurs.'],
      ['Ça marche en arabe ?', 'Oui. Toute l’application existe en français et en arabe.'],
      ['Et si je prends Amplify POS plus tard ?', 'Tout est déjà relié : vos fiches restent, et les ventes de la caisse alimentent vos marges automatiquement.'],
    ] as [string, string][],
  },
  final: { title: 'Sachez enfin ce que vous gagnez.', text: 'Créez votre compte et voyez vos premières marges aujourd’hui.', cta: 'Essayer Amplify Profit' },
  footer: 'Amplify Profit, conçu à Rabat par Amplify Growth Studio.',
};

type ProfitCopy = typeof fr;

const ar: ProfitCopy = {
  title: 'Amplify Profit · هوامش مطعمكم، طبقا بطبق',
  nav: { pos: 'Amplify POS', how: 'كيف يعمل', pricing: 'الأسعار', faq: 'أسئلة', login: 'تسجيل الدخول', cta: 'تجربة مجانية' },
  hero: {
    kicker: 'Amplify Profit',
    title1: 'تبيعون كثيرا.',
    title2: 'لكن كم تربحون فعلا؟',
    text: 'يحسب Amplify Profit كم يكلف كل طبق، وكم يربحكم حقا، وأي ثمن يجب طلبه. مع صندوقكم الحالي، أيا كان.',
    cta: 'جربوا 30 يوما مجانا',
    cta2: 'كيف يعمل',
    note: 'بدون بطاقة بنكية. بدون تغيير الصندوق.',
  },
  card: {
    label: 'بطاقة تقنية',
    dish: 'طاجين الدجاج بالحامض',
    lines: [['دجاج بلدي', '300 غ', '24,00'], ['حامض مصبر', '50 غ', '0,40'], ['زيتون', '30 غ', '1,20'], ['بصل، توابل، زيت', '', '2,60']],
    cost: 'تكلفة المواد', price: 'ثمن البيع', fc: 'نسبة التكلفة', margin: 'الهامش',
    alert: 'الدجاج +15% هذا الأسبوع: نسبة تكلفة الطاجين من 32,7% إلى 36,8%',
    example: 'مثال توضيحي',
  },
  pains: {
    kicker: 'المشكل',
    title: 'رقم المعاملات لا يقول كل شيء.',
    items: [
      ['مشترياتكم تتغير كل أسبوع', 'الدجاج، الزيت، الطماطم: الأسعار تتحرك، وأثمنة البيع تبقى كما هي. الهامش يذوب دون أن تروه.'],
      ['بعض الأطباق تخسركم المال', 'الأطباق الأكثر مبيعا ليست دائما الأكثر ربحا. بدون بطاقة تقنية يستحيل معرفة ذلك.'],
      ['كل شيء في رأسكم أو في دفتر', 'والحسابات تأخذ ساعات. فلا تُحسب أبدا.'],
    ],
  },
  features: {
    kicker: 'ما تحصلون عليه',
    title: 'مراقب تسيير في جيبكم.',
    ready: 'متوفر', soon: 'قريبا',
    items: [
      ['بطاقات تقنية في دقيقتين', 'يملأ الذكاء الاصطناعي الوصفة المعيارية لكل طبق بالكميات المعتادة في المغرب. وأنتم تعدلون.', true],
      ['تكلفة المواد والهامش لكل طبق', 'بالأخضر أو البرتقالي أو الأحمر. ترون فورا أي طبق يجب مراجعته.', true],
      ['الثمن المقترح', 'ثمن البيع الذي يحترم هدف هامشكم، مقرب إلى الدرهم.', true],
      ['قائمتكم مستوردة بصورة', 'صورة لقائمتكم أو ملف Excel: تنشأ أطباقكم تلقائيا.', true],
      ['فواتير الموردين بصورة', 'حتى وصولات السوق المكتوبة باليد. تتحدث الأسعار وتتوصلون بتنبيه.', false],
      ['المخزون والفوارق', 'عدّوا في 10 دقائق. شاهدوا ما ينقص، بالكيلو والدرهم.', false],
      ['الكراء، الأجور، عتبة المردودية', 'الرقم الذي يجب تحقيقه كل يوم لتكونوا مربحين.', false],
      ['الموظفون', 'الساعات، تكلفة الموظفين كنسبة من المعاملات، التخفيضات والإلغاءات لكل موظف.', false],
    ],
  },
  how: {
    kicker: 'كيف يعمل',
    title: 'بدون تغيير الصندوق.',
    text: 'يعمل Amplify Profit وحده، مع صندوقكم الحالي. ومع Amplify POS تصل المبيعات تلقائيا.',
    steps: [
      ['صورة لقائمتكم', 'يقرأ الذكاء الاصطناعي أطباقكم وأثمنتكم. في دقيقتين تكون قائمتكم جاهزة.'],
      ['الذكاء الاصطناعي يملأ البطاقات', 'وصفة معيارية وأسعار شراء تقديرية. تدخلون أسعاركم الحقيقية مع مشترياتكم.'],
      ['ترون هوامشكم', 'طبقا بطبق، مع الثمن المقترح للأطباق غير المربحة بما يكفي.'],
    ],
    together: 'مع Amplify POS: مبيعات الصندوق تعطي هامشكم الحقيقي للشهر، بدون أي إدخال.',
  },
  pricing: {
    kicker: 'الأسعار',
    title: 'طبق واحد محسوب خطأ يكلف أكثر.',
    per: 'درهم / شهر (بدون ضريبة)',
    note: '30 يوما مجانا. بدون التزام. الأسعار بدون ضريبة، لكل مطعم.',
    alone: { name: 'Amplify Profit', text: 'مع صندوقكم الحالي.', items: ['بطاقات تقنية بالذكاء الاصطناعي', 'تكلفة المواد والهامش والثمن المقترح', 'استيراد قائمتكم بصورة', 'العربية والفرنسية'] },
    both: { name: 'المراقبة', tag: 'POS + Profit', text: 'الصندوق والهوامش معا.', items: ['كل Amplify Profit', 'الصندوق والطاولات وقائمة QR', 'هوامش حقيقية من المبيعات', 'ملخص المساء بالذكاء الاصطناعي'] },
    choose: 'ابدأوا', best: 'الأكثر اكتمالا',
  },
  faq: {
    kicker: 'أسئلة',
    title: 'الأسئلة التي تطرح علينا.',
    items: [
      ['هل يجب تغيير الصندوق؟', 'لا. يعمل Amplify Profit وحده. تستوردون قائمتكم بصورة أو Excel وتحتفظون بصندوقكم.'],
      ['هل أسعار الذكاء الاصطناعي صحيحة؟', 'هي تقديرات للسوق المغربية، بعلامة «تقديري». تعوضونها بأسعار الشراء الحقيقية فتصبح الهوامش دقيقة.'],
      ['هل يرى فريقي أسعار الشراء؟', 'لا. فقط المالك والمسيرون يرون التكاليف. لا الصندوق ولا النادلون.'],
      ['هل يعمل بالعربية؟', 'نعم. التطبيق كله متوفر بالعربية والفرنسية.'],
      ['وإذا أخذت Amplify POS لاحقا؟', 'كل شيء مرتبط مسبقا: بطاقاتكم تبقى، ومبيعات الصندوق تغذي هوامشكم تلقائيا.'],
    ],
  },
  final: { title: 'اعرفوا أخيرا كم تربحون.', text: 'أنشئوا حسابكم وشاهدوا هوامشكم الأولى اليوم.', cta: 'جربوا Amplify Profit' },
  footer: 'Amplify Profit، صمم في الرباط من طرف Amplify Growth Studio.',
};

export const PROFIT_COPY: Record<SiteLang, ProfitCopy> = { fr, ar };
