// Texts of the "all features" page (posamplify.pages.dev/fonctionnalites), French and Arabic.
// Only what exists in the product: every line here can be shown in a demo.
import type { SiteLang } from './copy';

export type ModuleKey = 'pos' | 'waiter' | 'qr' | 'margins' | 'stock' | 'team' | 'money' | 'trust';
export interface FeatureModule { key: ModuleKey; tag: string; title: string; text: string; items: [string, string][] }

const fr = {
  title: 'Toutes les fonctionnalités · Amplify',
  nav: { back: 'Accueil', pricing: 'Tarifs', profit: 'Amplify Profit', login: 'Se connecter', cta: 'Essai gratuit' },
  hero: {
    kicker: 'Toutes les fonctionnalités',
    title1: 'Le système le plus complet',
    title2: 'pour votre restaurant.',
    text: 'Caisse, commande à table, menu QR, marges, stock, équipe, charges. Tout parle ensemble, en français et en arabe, et tout est compris dans l’abonnement.',
    stats: [['modules', 'reliés entre eux'], ['fonctions', 'incluses, sans option payante'], ['langues', 'français et arabe partout, menu QR aussi en anglais']] as [string, string][],
    cta: 'Essayer 30 jours gratuitement',
    cta2: 'Voir les tarifs',
  },
  jump: 'Aller à',
  modules: [
    {
      key: 'pos', tag: 'Amplify POS', title: 'La caisse',
      text: 'Une caisse tactile pensée pour le service marocain : rapide aux heures de pointe, et qui ne s’arrête jamais.',
      items: [
        ['Sur PC, tablette ou téléphone', 'Rien à installer : la caisse s’ouvre dans Chrome. Un PC existant et une imprimante ticket standard suffisent.'],
        ['Fonctionne sans internet', 'Coupure de connexion ? Commandes, bons cuisine et encaissements continuent. Tout se synchronise tout seul au retour d’internet.'],
        ['Plan de salle et zones', 'Tables par zone (salle, terrasse, étage), temps d’occupation, montant en cours. Changer de table ou regrouper deux additions en un geste.'],
        ['Sur place, à emporter, livraison, Glovo', 'Chaque type de commande a son circuit : nom et téléphone du client, adresse de livraison, référence Glovo.'],
        ['Bons cuisine et bar automatiques', 'Chaque article part vers le bon poste d’impression, avec les précisions (« sans oignon », « bien cuit ») et le nom du serveur.'],
        ['Écran cuisine et bar', 'Une tablette ou une télé en cuisine affiche les bons de son poste, avec le temps d’attente en couleur. Un geste : prêt. Le client QR le voit aussi.'],
        ['Tous les moyens de paiement', 'Espèces avec calcul du rendu, carte, virement, paiement mixte (espèces + carte), pourboire enregistré par employé.'],
        ['Partager l’addition', 'Par article (chacun reçoit son propre ticket, le reste reste sur la table) ou en parts égales, arrondies au dirham.'],
        ['Suppléments et formules', 'Fromage + 5 DH, cuisson au choix, formule petit-déjeuner avec boisson et viennoiserie au choix. Prix calculés automatiquement, sur la caisse et le menu QR.'],
        ['Tickets et factures conformes', 'Tickets numérotés et chaînés (impossibles à modifier), factures avec l’ICE du client, avoirs pour corriger une vente encaissée.'],
        ['Remises et annulations sous contrôle', 'Une remise, une annulation ou un article retiré après envoi en cuisine demande toujours le code d’un manager. Tout est tracé.'],
        ['Rapports X et Z', 'Chiffre du jour, TVA par taux, paiements, remises, avoirs, ventes par employé. Clôture Z définitive, imprimée.'],
        ['Comptage de caisse à l’aveugle', 'À la clôture, le manager compte les espèces sans voir le montant attendu. L’écart s’affiche ensuite et reste enregistré.'],
        ['Fond de caisse et sorties', 'Fond du matin, paiement d’un fournisseur depuis la caisse, dépôt en banque : les espèces attendues restent justes.'],
        ['Codes personnels', 'Chaque employé entre avec son code. Verrouillage automatique après quelques minutes sans activité.'],
        ['Arabe ou français, par employé', 'Chaque employé choisit sa langue sur la caisse. Les bons cuisine et les tickets restent dans la langue du restaurant.'],
      ],
    },
    {
      key: 'waiter', tag: 'Amplify POS', title: 'Commande à table sur téléphone',
      text: 'Vos serveurs prennent la commande à la table, sur leur propre téléphone. La cuisine la reçoit tout de suite.',
      items: [
        ['Le téléphone du serveur devient un terminal', 'Même application que la caisse, en version téléphone : tables, carte, ticket. Aucune application à télécharger.'],
        ['Le bon s’imprime à la caisse', 'Le téléphone n’a pas besoin d’imprimante : la caisse imprime le bon cuisine ou bar automatiquement, avec le nom du serveur.'],
        ['Rapide à apprendre', 'Choisir la table, toucher les plats, envoyer. Recherche par nom, catégories en un geste, précisions pour la cuisine.'],
        ['Un bon imprimé une seule fois', 'Même avec deux caisses équipées d’imprimante, chaque bon ne sort qu’une fois.'],
        ['L’encaissement reste à la caisse', 'Les espèces et les tickets fiscaux restent au même endroit : la caisse reste juste et la clôture simple.'],
      ],
    },
    {
      key: 'qr', tag: 'Amplify POS', title: 'Menu QR et commande client',
      text: 'Votre carte sur le téléphone de vos clients, à vos couleurs, dans leur langue.',
      items: [
        ['Menu QR en trois langues', 'Français, arabe (de droite à gauche) et anglais. Photos, descriptions, options et tailles, aux couleurs de votre restaurant.'],
        ['Commande depuis la table', 'Le client commande depuis le QR de sa table. La caisse sonne, vous acceptez, et le bon part en cuisine.'],
        ['Suivi en direct pour le client', 'Reçue, en préparation, prête, servie : le client suit sa commande sur son téléphone.'],
        ['« Épuisé » en un clic', 'Un plat en rupture disparaît de la commande immédiatement, sur la caisse et sur le menu QR.'],
        ['Votre carte importée en photo', 'Une photo de votre menu papier ou un fichier Excel : plats, prix et catégories sont créés automatiquement. Aucune ressaisie.'],
        ['QR codes de table prêts à imprimer', 'Chaque table a son QR code. Le numéro de table arrive avec la commande.'],
      ],
    },
    {
      key: 'margins', tag: 'Amplify Profit', title: 'Marges et fiches techniques',
      text: 'Ce que coûte vraiment chaque plat, ce qu’il vous rapporte, et le bon prix de vente.',
      items: [
        ['Fiches techniques remplies par l’IA', 'L’IA propose la recette standard de chaque plat avec les quantités habituelles au Maroc. Vous ajustez, en grammes, centilitres ou pièces.'],
        ['Food cost et marge par plat', 'En vert, orange ou rouge selon votre objectif. Le coût tient compte des pertes (os, épluchures).'],
        ['Prix de vente conseillé', 'Le prix qui respecte votre objectif de food cost, arrondi au dirham.'],
        ['Marge réelle avec les ventes', 'Avec Amplify POS, chaque plat vendu compte : vous voyez la marge gagnée sur le mois, plat par plat.'],
        ['Analyse du menu', 'Stars, plats populaires mais peu rentables, plats rentables mais peu vendus, plats à retirer. Chaque plat est comparé à sa catégorie.'],
        ['Historique des prix d’achat', 'Chaque changement de prix est gardé : vous voyez quand la viande ou l’huile a augmenté, et l’effet sur vos plats.'],
      ],
    },
    {
      key: 'stock', tag: 'Amplify Profit', title: 'Stock, achats et écarts',
      text: 'Savoir ce que vous avez, quoi acheter, et où part votre marchandise.',
      items: [
        ['Inventaire sur téléphone', 'Comptez le soir après le service, produit par produit, en kilos, litres ou pièces. Commencez par les produits chers.'],
        ['Achats en une saisie', 'Une livraison de dix produits se note en une fois. Le prix payé met à jour le coût de vos plats automatiquement.'],
        ['Écart vendu / utilisé en dirhams', 'Avec Amplify POS : ce que vous avez utilisé, ce que la caisse a vendu, et la différence par produit. Perte, gratuit ou vol se voient.'],
        ['Stock en temps réel', 'Dernier comptage + achats − ce qui est vendu (ou votre consommation moyenne sans caisse). Avec les jours de stock restants.'],
        ['Conseil d’achat', 'Ce qu’il faut acheter pour les prochains jours, arrondi comme on achète (demi-kilo, caisse entière), avec le budget.'],
        ['Liste de commande par WhatsApp', 'La liste part au fournisseur en un geste. Après l’achat, tout est prérempli : vous confirmez les vrais prix.'],
      ],
    },
    {
      key: 'team', tag: 'Amplify Profit', title: 'Équipe et contrôle',
      text: 'Les heures, ce que coûte l’équipe, et qui laisse filer de l’argent. Des faits, pas des soupçons.',
      items: [
        ['Pointage avec le code personnel', 'Arrivée et départ sur l’écran de la caisse. Un départ oublié est signalé pour correction.'],
        ['Coût du personnel en % du chiffre', 'Heures × coût horaire (charges comprises), comparé au chiffre d’affaires. Calcul du coût horaire depuis le salaire mensuel.'],
        ['Chaque employé, en chiffres', 'Ventes, ticket moyen, remises, annulations, avoirs, sorties de caisse, pourboires.'],
        ['Articles retirés après la cuisine', 'Un plat préparé puis retiré de l’addition : le signe de vol le plus fréquent en restaurant, par employé et en dirhams.'],
        ['Alerte « à surveiller »', 'Quand un employé laisse partir bien plus d’argent que le reste de l’équipe, vous êtes prévenu.'],
        ['Écart de caisse par clôture', 'Le comptage à l’aveugle de chaque clôture, rattaché au manager qui l’a faite.'],
        ['Journal de toutes les actions', 'Modifications de prix, de menu, d’heures, remises, annulations : qui, quoi, quand. Rien ne s’efface.'],
      ],
    },
    {
      key: 'money', tag: 'Amplify Profit', title: 'Charges, résultat et point mort',
      text: 'Ce qui reste vraiment à la fin du mois, et le chiffre à faire chaque jour.',
      items: [
        ['Toutes vos charges fixes', 'Loyer, salaires, CNSS et AMO, électricité, eau, internet, assurance, crédit, comptable. Par mois, par an ou par semaine.'],
        ['Résultat du mois', 'Chiffre d’affaires − marchandises − charges fixes. Depuis la caisse, ou avec vos tickets Z si vous gardez votre caisse actuelle.'],
        ['Point mort par jour', 'Le chiffre d’affaires à faire chaque jour d’ouverture pour ne pas perdre d’argent, et où vous en êtes aujourd’hui.'],
        ['Briefing du soir', 'Le résumé de la journée en langage simple : ce qui a marché, ce qui a coincé, quoi faire demain.'],
        ['Export pour le comptable', 'Vos ventes en un fichier lisible par votre comptable, quand vous voulez.'],
      ],
    },
    {
      key: 'trust', tag: 'Amplify', title: 'Sécurité et service',
      text: 'Vos données restent à vous, et vous avez une vraie personne en face.',
      items: [
        ['Données séparées par restaurant', 'Chaque restaurant ne voit que ses propres données. Rôles propriétaire, manager et caisse.'],
        ['Les salaires jamais sur la caisse', 'Les coûts horaires et les marges ne sont visibles que par le propriétaire et les managers.'],
        ['Avis Google', 'Un QR code sous chaque ticket et sur le menu pour obtenir plus d’avis, dans le respect des règles de Google.'],
        ['Installation sur place à Rabat', 'Nous installons la caisse, importons votre carte et formons votre équipe.'],
        ['Support WhatsApp', 'Un vrai interlocuteur qui connaît votre restaurant.'],
        ['Sans engagement', 'Abonnement mensuel, résiliable à tout moment. Vos données s’exportent quand vous voulez.'],
      ],
    },
  ] as FeatureModule[],
  final: { title: 'Tout ça, dans un seul abonnement.', text: 'Essayez 30 jours gratuitement. Votre carte est prête le jour même.', cta: 'Créer mon restaurant', pricing: 'Voir les tarifs' },
  footer: 'Amplify, conçu à Rabat par Amplify Growth Studio.',
};

type Copy = typeof fr;

const ar: Copy = {
  title: 'كل المميزات · Amplify',
  nav: { back: 'الرئيسية', pricing: 'الأسعار', profit: 'Amplify Profit', login: 'تسجيل الدخول', cta: 'تجربة مجانية' },
  hero: {
    kicker: 'كل المميزات',
    title1: 'النظام الأكثر اكتمالا',
    title2: 'لمطعمكم.',
    text: 'الصندوق، الطلب على الطاولة، قائمة QR، الهوامش، المخزون، الفريق، التكاليف. كل شيء مرتبط، بالعربية والفرنسية، وكل شيء مشمول في الاشتراك.',
    stats: [['وحدات', 'مرتبطة ببعضها'], ['وظيفة', 'مشمولة، بدون خيارات مؤدى عنها'], ['لغتان', 'العربية والفرنسية في كل شيء، وقائمة QR أيضا بالإنجليزية']],
    cta: 'جربوه 30 يوما مجانا',
    cta2: 'شاهدوا الأسعار',
  },
  jump: 'انتقلوا إلى',
  modules: [
    {
      key: 'pos', tag: 'Amplify POS', title: 'الصندوق',
      text: 'صندوق باللمس مصمم للخدمة في المغرب: سريع في أوقات الذروة، ولا يتوقف أبدا.',
      items: [
        ['على الحاسوب أو اللوحة أو الهاتف', 'لا شيء للتثبيت: الصندوق يفتح في Chrome. حاسوب موجود وطابعة تذاكر عادية تكفي.'],
        ['يعمل بدون إنترنت', 'انقطع الاتصال؟ الطلبات ووصولات المطبخ والتحصيل تستمر. كل شيء يتزامن تلقائيا عند رجوع الإنترنت.'],
        ['مخطط القاعة والمناطق', 'الطاولات حسب المنطقة (القاعة، التراس، الطابق)، مدة الجلوس، المبلغ الجاري. تغيير الطاولة أو جمع فاتورتين بحركة واحدة.'],
        ['في المكان، للأخذ، التوصيل، Glovo', 'لكل نوع طلب مساره: اسم وهاتف الزبون، عنوان التوصيل، مرجع Glovo.'],
        ['وصولات المطبخ والبار تلقائيا', 'كل مادة تذهب إلى طابعة القسم المناسب، مع التوضيحات (« بدون بصل »، « مطهو جيدا ») واسم النادل.'],
        ['شاشة المطبخ والبار', 'لوحة أو تلفاز في المطبخ يعرض وصولات قسمه، مع مدة الانتظار بالألوان. لمسة واحدة: جاهز. وزبون QR يرى ذلك أيضا.'],
        ['كل وسائل الأداء', 'نقدا مع حساب الباقي، بالبطاقة، بالتحويل، أداء مختلط (نقدا + بطاقة)، بقشيش مسجل لكل موظف.'],
        ['تقسيم الفاتورة', 'حسب المادة (كل واحد يتوصل بتذكرته، والباقي يبقى على الطاولة) أو بالتساوي، مقربا إلى الدرهم.'],
        ['الإضافات والوجبات', 'جبن + 5 دراهم، طريقة الطهي، وجبة فطور مع مشروب ومعجنات للاختيار. الأثمنة تحسب تلقائيا، في الصندوق وقائمة QR.'],
        ['تذاكر وفواتير مطابقة', 'تذاكر مرقمة ومتسلسلة (لا يمكن تعديلها)، فواتير مع ICE الزبون، أرصدة دائنة لتصحيح بيع مؤدى.'],
        ['التخفيضات والإلغاءات تحت المراقبة', 'التخفيض أو الإلغاء أو حذف مادة بعد إرسالها للمطبخ يتطلب دائما رمز المسير. كل شيء مسجل.'],
        ['تقارير X و Z', 'رقم اليوم، الضريبة حسب النسبة، الأداءات، التخفيضات، الأرصدة، المبيعات لكل موظف. إغلاق Z نهائي ومطبوع.'],
        ['عد الصندوق دون رؤية المنتظر', 'عند الإغلاق، يحسب المسير النقود دون رؤية المبلغ المنتظر. ثم يظهر الفرق ويبقى مسجلا.'],
        ['صندوق البداية والمصاريف', 'صندوق الصباح، أداء مورد من الصندوق، إيداع في البنك: النقود المنتظرة تبقى مضبوطة.'],
        ['رموز شخصية', 'كل موظف يدخل برمزه. قفل تلقائي بعد بضع دقائق بدون نشاط.'],
        ['العربية أو الفرنسية، لكل موظف', 'كل موظف يختار لغته على الصندوق. وصولات المطبخ والتذاكر تبقى بلغة المطعم.'],
      ],
    },
    {
      key: 'waiter', tag: 'Amplify POS', title: 'الطلب على الطاولة بالهاتف',
      text: 'النادلون يأخذون الطلب على الطاولة، بهاتفهم الخاص. المطبخ يتوصل به فورا.',
      items: [
        ['هاتف النادل يصبح جهاز طلب', 'نفس تطبيق الصندوق، بنسخة الهاتف: الطاولات، القائمة، التذكرة. بدون تطبيق للتحميل.'],
        ['الوصل يطبع في الصندوق', 'الهاتف لا يحتاج طابعة: الصندوق يطبع وصل المطبخ أو البار تلقائيا، مع اسم النادل.'],
        ['سهل التعلم', 'اختيار الطاولة، لمس الأطباق، الإرسال. البحث بالاسم، الفئات بلمسة، توضيحات للمطبخ.'],
        ['وصل يطبع مرة واحدة فقط', 'حتى مع صندوقين بطابعة، كل وصل يخرج مرة واحدة.'],
        ['الأداء يبقى في الصندوق', 'النقود والتذاكر الضريبية تبقى في نفس المكان: الصندوق يبقى مضبوطا والإغلاق سهلا.'],
      ],
    },
    {
      key: 'qr', tag: 'Amplify POS', title: 'قائمة QR وطلب الزبون',
      text: 'قائمتكم على هاتف زبائنكم، بألوانكم، وبلغتهم.',
      items: [
        ['قائمة QR بثلاث لغات', 'الفرنسية والعربية (من اليمين إلى اليسار) والإنجليزية. صور، أوصاف، خيارات وأحجام، بألوان مطعمكم.'],
        ['الطلب من الطاولة', 'الزبون يطلب من رمز QR طاولته. الصندوق يرن، تقبلون، والوصل يذهب للمطبخ.'],
        ['تتبع مباشر للزبون', 'تم الاستلام، قيد التحضير، جاهز، تم التقديم: الزبون يتابع طلبه على هاتفه.'],
        ['« نفد » بنقرة واحدة', 'طبق نفد يختفي من الطلب فورا، على الصندوق وعلى قائمة QR.'],
        ['استيراد قائمتكم بصورة', 'صورة لقائمتكم الورقية أو ملف Excel: الأطباق والأثمنة والفئات تنشأ تلقائيا. بدون إعادة إدخال.'],
        ['رموز QR للطاولات جاهزة للطباعة', 'لكل طاولة رمزها. رقم الطاولة يصل مع الطلب.'],
      ],
    },
    {
      key: 'margins', tag: 'Amplify Profit', title: 'الهوامش والبطاقات التقنية',
      text: 'كم يكلف كل طبق فعلا، كم يربحكم، والثمن المناسب للبيع.',
      items: [
        ['بطاقات تقنية يملؤها الذكاء الاصطناعي', 'الذكاء الاصطناعي يقترح الوصفة المعتادة لكل طبق بالكميات المعروفة في المغرب. تعدلون بالغرام أو السنتيلتر أو القطعة.'],
        ['تكلفة المواد والهامش لكل طبق', 'بالأخضر أو البرتقالي أو الأحمر حسب هدفكم. التكلفة تحسب الضياع (العظام، القشور).'],
        ['الثمن المقترح', 'الثمن الذي يحترم هدف تكلفة المواد، مقربا إلى الدرهم.'],
        ['الهامش الحقيقي مع المبيعات', 'مع Amplify POS، كل طبق مباع يحسب: ترون الهامش المحقق في الشهر، طبقا بطبق.'],
        ['تحليل القائمة', 'النجوم، الأطباق الشعبية قليلة المردودية، الأطباق المربحة قليلة المبيعات، الأطباق التي يجب سحبها. كل طبق يقارن بفئته.'],
        ['تاريخ أثمنة الشراء', 'كل تغيير في الثمن محفوظ: ترون متى ارتفع ثمن اللحم أو الزيت، وأثره على أطباقكم.'],
      ],
    },
    {
      key: 'stock', tag: 'Amplify Profit', title: 'المخزون والمشتريات والفروقات',
      text: 'اعرفوا ما لديكم، ماذا تشترون، وأين تذهب بضاعتكم.',
      items: [
        ['الجرد على الهاتف', 'احسبوا في المساء بعد الخدمة، منتجا بمنتج، بالكيلو أو اللتر أو القطعة. ابدؤوا بالمنتجات الغالية.'],
        ['المشتريات في إدخال واحد', 'توصيل بعشرة منتجات يسجل مرة واحدة. الثمن المدفوع يحدث تكلفة أطباقكم تلقائيا.'],
        ['فرق المباع والمستعمل بالدرهم', 'مع Amplify POS: ما استعملتموه، ما باعه الصندوق، والفرق لكل منتج. الضياع أو المجاني أو السرقة تظهر.'],
        ['المخزون في الوقت الحقيقي', 'آخر جرد + المشتريات − ما بيع (أو استهلاككم المتوسط بدون صندوق). مع أيام المخزون المتبقية.'],
        ['نصيحة الشراء', 'ما يجب شراؤه للأيام القادمة، مقربا كما نشتري (نصف كيلو، صندوق كامل)، مع الميزانية.'],
        ['لائحة الطلب عبر واتساب', 'اللائحة تذهب للمورد بلمسة. بعد الشراء، كل شيء معبأ مسبقا: تؤكدون الأثمنة الحقيقية.'],
      ],
    },
    {
      key: 'team', tag: 'Amplify Profit', title: 'الفريق والمراقبة',
      text: 'الساعات، تكلفة الفريق، ومن يضيع المال. وقائع، وليس شكوكا.',
      items: [
        ['التسجيل بالرمز الشخصي', 'الوصول والمغادرة على شاشة الصندوق. مغادرة منسية يتم التنبيه إليها للتصحيح.'],
        ['تكلفة الموظفين كنسبة من الرقم', 'الساعات × تكلفة الساعة (مع التكاليف)، مقارنة برقم المعاملات. حساب تكلفة الساعة من الأجر الشهري.'],
        ['كل موظف بالأرقام', 'المبيعات، متوسط التذكرة، التخفيضات، الإلغاءات، الأرصدة، المصاريف من الصندوق، البقشيش.'],
        ['مواد حذفت بعد المطبخ', 'طبق حضر ثم حذف من الفاتورة: أكثر علامات السرقة شيوعا في المطاعم، لكل موظف وبالدرهم.'],
        ['تنبيه « للمراقبة »', 'عندما يضيع موظف مالا أكثر بكثير من باقي الفريق، يتم إخباركم.'],
        ['فرق الصندوق لكل إغلاق', 'عد كل إغلاق دون رؤية المنتظر، مرتبط بالمسير الذي قام به.'],
        ['سجل كل العمليات', 'تغييرات الأثمنة، القائمة، الساعات، التخفيضات، الإلغاءات: من، ماذا، متى. لا شيء يمحى.'],
      ],
    },
    {
      key: 'money', tag: 'Amplify Profit', title: 'التكاليف والنتيجة وعتبة المردودية',
      text: 'ما يبقى فعلا في آخر الشهر، والرقم الواجب تحقيقه كل يوم.',
      items: [
        ['كل تكاليفكم الثابتة', 'الكراء، الأجور، CNSS و AMO، الكهرباء، الماء، الإنترنت، التأمين، القرض، المحاسب. شهريا أو سنويا أو أسبوعيا.'],
        ['نتيجة الشهر', 'رقم المعاملات − البضاعة − التكاليف الثابتة. من الصندوق، أو بتذاكر Z إذا احتفظتم بصندوقكم الحالي.'],
        ['عتبة المردودية لكل يوم', 'رقم المعاملات الواجب تحقيقه كل يوم عمل لتفادي الخسارة، وأين أنتم اليوم.'],
        ['ملخص المساء', 'ملخص اليوم بلغة بسيطة: ما نجح، ما تعثر، ماذا تفعلون غدا.'],
        ['تصدير للمحاسب', 'مبيعاتكم في ملف يقرؤه محاسبكم، متى شئتم.'],
      ],
    },
    {
      key: 'trust', tag: 'Amplify', title: 'الأمان والخدمة',
      text: 'بياناتكم تبقى لكم، ولديكم شخص حقيقي أمامكم.',
      items: [
        ['بيانات منفصلة لكل مطعم', 'كل مطعم لا يرى إلا بياناته. أدوار المالك والمسير والصندوق.'],
        ['الأجور لا تظهر أبدا على الصندوق', 'تكاليف الساعات والهوامش لا يراها إلا المالك والمسيرون.'],
        ['آراء Google', 'رمز QR أسفل كل تذكرة وفي القائمة للحصول على آراء أكثر، مع احترام قواعد Google.'],
        ['التركيب في عين المكان بالرباط', 'نركب الصندوق، نستورد قائمتكم ونكون فريقكم.'],
        ['دعم عبر واتساب', 'شخص حقيقي يعرف مطعمكم.'],
        ['بدون التزام', 'اشتراك شهري، يمكن إلغاؤه في أي وقت. بياناتكم تصدر متى شئتم.'],
      ],
    },
  ],
  final: { title: 'كل هذا، في اشتراك واحد.', text: 'جربوه 30 يوما مجانا. قائمتكم جاهزة في نفس اليوم.', cta: 'إنشاء مطعمي', pricing: 'شاهدوا الأسعار' },
  footer: 'Amplify، صُمم في الرباط من طرف Amplify Growth Studio.',
};

export const FEATURES_COPY: Record<SiteLang, Copy> = { fr, ar };
