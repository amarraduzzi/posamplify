// Contenu du guide intégré (page « Aide »). Un chapitre = un tableau d'articles.
// Pour ajouter un chapitre : créer son tableau, l'ajouter à CHAPTERS et à ARTICLES.
// `products` (optionnel) : l'article n'apparaît que si le restaurant a l'un de ces produits (pos, profit, orders, loyalty, agenda).

export type Block =
  | { t: 'p'; text: string }
  | { t: 'steps'; items: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'tip'; text: string }
  | { t: 'warn'; text: string };

export interface Article {
  id: string;
  chapter: string;
  title: string;
  /** mots que les clients tapent dans la recherche (synonymes, termes arabes/anglais, fautes courantes) */
  keywords: string[];
  summary: string;
  blocks: Block[];
  products?: string[];
}

export interface Chapter { id: string; title: string; blurb: string }

export const CHAPTERS: Chapter[] = [
  { id: 'start', title: 'Premiers pas', blurb: 'Créer votre restaurant, relier la caisse, ajouter vos employés.' },
  { id: 'till', title: 'La caisse', blurb: 'Tables, commandes, encaissement, remises, rapports et clôture de journée.' },
  { id: 'menu', title: 'Le menu et les tables', blurb: 'Catégories, articles, options, import de votre carte, tables et QR codes.' },
];

const START: Article[] = [
  {
    id: 'start-create', chapter: 'start', title: 'Créer votre restaurant',
    keywords: ['inscription', 'compte', 'démarrer', 'assistant', 'wizard', 'essai', 'gratuit', 'adresse', 'lien', 'nom'],
    summary: 'L’assistant de démarrage et les informations à donner. 14 jours d’essai gratuit.',
    blocks: [
      { t: 'p', text: 'À la première connexion, un assistant vous guide. Vous avez 14 jours d’essai gratuit, sans engagement.' },
      { t: 'ul', items: [
        'Le nom du restaurant et votre ville.',
        'L’adresse de votre menu : c’est le lien que vos clients ouvrent en scannant le QR code. Si elle est déjà prise, choisissez-en une autre.',
        'Votre type d’établissement.',
        'Le nombre de tables : mettez 0 si vous faites uniquement de l’emporter. Vous pourrez ajouter des zones (terrasse, salle) plus tard.',
        'Votre prénom et votre code personnel (4 à 6 chiffres).',
      ] },
      { t: 'warn', text: 'Vous êtes manager : votre code valide les remises, les annulations et la clôture de journée. Gardez-le pour vous.' },
    ],
  },
  {
    id: 'start-menu', chapter: 'start', title: 'Préparer votre menu au démarrage',
    keywords: ['carte', 'import', 'excel', 'photo', 'pdf', 'catégories', 'articles', 'prix', 'plats'],
    summary: 'Trois façons de commencer : importer votre carte, partir de catégories prêtes, ou tout saisir.',
    blocks: [
      { t: 'ul', items: [
        'Importer votre carte (photo, PDF ou Excel) : le plus rapide, vos plats et vos prix sont créés pour vous.',
        'Partir de catégories toutes prêtes, puis ajouter vos articles et prix.',
        'Ajouter vos articles à la main plus tard, depuis la page « Menu ».',
      ] },
      { t: 'tip', text: 'Tout reste modifiable après coup : noms, prix, photos, catégories.' },
    ],
  },
  {
    id: 'start-pair', chapter: 'start', title: 'Relier votre caisse', products: ['pos'],
    keywords: ['caisse', 'connecter', 'code', 'qr', 'tablette', 'ordinateur', 'chrome', 'écran d’accueil', 'installer', 'android', 'appareil', 'relier'],
    summary: 'Un code à usage unique suffit : pas de mot de passe à retenir.',
    blocks: [
      { t: 'p', text: 'La caisse fonctionne dans le navigateur (Chrome) de n’importe quel ordinateur ou tablette.' },
      { t: 'steps', items: [
        'Dans l’espace de gestion, ouvrez « Caisses » puis « Relier une caisse ».',
        'Donnez un nom à l’appareil, par exemple « Caisse comptoir ».',
        'Sur l’ordinateur ou la tablette de caisse, ouvrez l’adresse affichée et tapez le code, ou scannez le QR code avec l’appareil photo.',
        'Le code est valable jusqu’à l’heure indiquée, une seule fois.',
        'Pour l’ouvrir comme une application : « Ajouter à l’écran d’accueil » dans le navigateur.',
      ] },
      { t: 'tip', text: 'Sur tablette Android, vous pouvez installer l’application Amplify Caisse (QR code de téléchargement dans la page « Caisses »). Si « Application inconnue » s’affiche, choisissez « Installer quand même ».' },
      { t: 'warn', text: 'La formule Essentiel inclut 1 caisse. Pour relier d’autres caisses ou les téléphones de vos serveurs, passez à la formule Restaurant. Pour remplacer une caisse, retirez d’abord l’ancienne.' },
    ],
  },
  {
    id: 'start-lost', chapter: 'start', title: 'Appareil perdu ou volé', products: ['pos'],
    keywords: ['perdu', 'volé', 'retirer', 'sécurité', 'accès', 'révoquer', 'remplacer'],
    summary: 'Retirez l’appareil : il perd immédiatement l’accès.',
    blocks: [
      { t: 'steps', items: [
        'Ouvrez « Caisses ».',
        'Trouvez l’appareil dans la liste et cliquez sur « Retirer ».',
        'L’appareil perd l’accès tout de suite. Vous pouvez ensuite relier un nouvel appareil avec un nouveau code.',
      ] },
    ],
  },
  {
    id: 'start-staff', chapter: 'start', title: 'Ajouter vos employés', products: ['pos', 'loyalty'],
    keywords: ['personnel', 'serveur', 'code', 'pin', 'prénom', 'manager', 'employé', 'équipe'],
    summary: 'Chacun choisit son prénom sur la caisse et tape son code.',
    blocks: [
      { t: 'p', text: 'Sur la caisse, chaque employé choisit son prénom puis tape son code personnel.' },
      { t: 'steps', items: ['Ouvrez la page « Personnel ».', 'Ajoutez chaque employé avec son prénom et son code.'] },
    ],
  },
];

const TILL: Article[] = [
  {
    id: 'till-login', chapter: 'till', title: 'Se connecter et pointer', products: ['pos'],
    keywords: ['code', 'pin', 'employé', 'serveur', 'pointage', 'arrivée', 'départ', 'changer', 'verrouiller', 'déconnecter', 'heures'],
    summary: 'Chacun choisit son prénom, tape son code et peut pointer son arrivée et son départ.',
    blocks: [
      { t: 'steps', items: [
        'Sur l’écran d’accueil de la caisse, choisissez votre prénom.',
        'Tapez votre code personnel. Si le code est incorrect, un message s’affiche : recommencez.',
        'Pour changer d’employé, utilisez « Changer d’employé » ; le poste se verrouille et le suivant tape son code.',
      ] },
      { t: 'p', text: 'Pointage : « Pointer arrivée / départ » enregistre vos heures. Le temps de travail s’affiche au départ. Si un départ n’a pas été pointé, le gérant le corrigera.' },
      { t: 'warn', text: 'La première connexion d’un employé sur un poste, et le pointage, demandent une connexion internet.' },
      { t: 'tip', text: '« Déconnecter ce poste » retire le lien entre la caisse et votre restaurant : à n’utiliser que si vous changez d’appareil. Un nouveau code de connexion sera alors nécessaire.' },
    ],
  },
  {
    id: 'till-tables', chapter: 'till', title: 'Les tables et le plan de salle', products: ['pos'],
    keywords: ['plan', 'salle', 'liste', 'libre', 'occupée', 'réservée', 'emporter', 'livraison', 'dessiner', 'terrasse', 'bar', 'statut'],
    summary: 'Voir d’un coup d’œil quelles tables sont libres, occupées ou à servir.',
    blocks: [
      { t: 'p', text: 'L’onglet « Tables » affiche vos tables en vue « Plan » (comme dans votre salle) ou en vue « Liste ». Chaque table indique son état :' },
      { t: 'ul', items: [
        'Libre : prête à recevoir une commande.',
        'Occupée : une commande est en cours, avec le temps écoulé en minutes.',
        'Réservée bientôt : une réservation arrive.',
        'Plat prêt à servir : la cuisine a terminé.',
        'À accepter : un client a commandé par QR code et vous devez valider sa commande.',
      ] },
      { t: 'p', text: 'Pour une vente sans table, utilisez « Nouvelle commande à emporter » ou « Livraison (téléphone) ». Pour la livraison, indiquez l’adresse.' },
      { t: 'steps', items: [
        'Touchez « Dessiner le plan » (ou « Modifier le plan »).',
        'Placez les tables comme dans le restaurant, avec le bar et l’entrée.',
        'Touchez « C’est fait ». Les serveurs voient désormais le plan.',
      ] },
      { t: 'tip', text: 'Les tables elles-mêmes (noms, nombre, zones, QR codes) se créent dans l’espace de gestion, page « Tables & QR codes ».' },
    ],
  },
  {
    id: 'till-order', chapter: 'till', title: 'Prendre une commande', products: ['pos'],
    keywords: ['commande', 'ajouter', 'article', 'précision', 'allergie', 'envoyer', 'cuisine', 'nombre de personnes', 'suite', 'service', 'changer de table', 'regrouper', 'ticket'],
    summary: 'Ajouter des articles, préciser pour la cuisine et envoyer en cuisine.',
    blocks: [
      { t: 'steps', items: [
        'Touchez une table libre (ou « Nouvelle commande à emporter »).',
        'Indiquez le nombre de personnes si on vous le demande.',
        'Touchez les articles à ajouter. Si un article a des options ou des tailles, choisissez-les.',
        'Pour une demande particulière, ajoutez une précision : « Allergie, demande particulière… ». Elle apparaît sur le bon de cuisine.',
        'Touchez « Envoyer en cuisine ».',
      ] },
      { t: 'p', text: 'Tant qu’ils ne sont pas envoyés, les articles restent dans « Articles non envoyés ». Si vous quittez la commande, la caisse vous prévient du nombre d’articles non envoyés : choisissez « Envoyer et quitter » ou « Abandonner ».' },
      { t: 'p', text: 'Par services : vous pouvez envoyer l’entrée d’abord, puis « Envoyer la suite » le moment venu.' },
      { t: 'ul', items: [
        'Changer de table : « Changer table ». Si la table est occupée, les deux additions sont regroupées.',
        'Plusieurs commandes sur une même table : elles s’affichent ensemble (« Commandes regroupées »).',
        'Client : associez un client à la commande pour sa cagnotte ou son ardoise.',
      ] },
    ],
  },
  {
    id: 'till-qr', chapter: 'till', title: 'Commandes des clients (QR) et en ligne', products: ['pos', 'orders'],
    keywords: ['qr', 'accepter', 'en ligne', 'pause', 'whatsapp', 'livreur', 'livraison', 'prête', 'emporter', 'code de livraison'],
    summary: 'Accepter les commandes que vos clients passent eux-mêmes.',
    blocks: [
      { t: 'p', text: 'Quand un client commande depuis son téléphone, la caisse l’indique (« commande client (QR) à accepter ») et la table passe en « À accepter ». Ouvrez la commande et touchez « Accepter » ; vous pouvez aussi « Annuler ».' },
      { t: 'p', text: 'Pour une commande en ligne à emporter ou en livraison, indiquez le délai de préparation. Vous pouvez ensuite :' },
      { t: 'ul', items: [
        '« Confirmer au client sur WhatsApp » : un message prêt à envoyer.',
        '« Prévenir : commande prête » quand elle est prête.',
        'Pour une livraison : « Choisir le livreur », puis « Envoyer la course sur WhatsApp ». Un code de livraison est à donner au livreur ; le client le donne en échange de sa commande.',
        '« Remettre au client » une fois la commande donnée.',
      ] },
      { t: 'tip', text: '« Pause 15 min » (ou 30 min / 1 h) suspend temporairement les commandes en ligne quand vous êtes débordé. « Reprendre » les rouvre tout de suite.' },
    ],
  },
  {
    id: 'till-pay', chapter: 'till', title: 'Encaisser', products: ['pos'],
    keywords: ['encaisser', 'payer', 'espèces', 'carte', 'tpe', 'mixte', 'virement', 'ardoise', 'crédit', 'pourboire', 'monnaie', 'rendre', 'facture', 'ice', 'acompte', 'ticket', 'addition', 'reçu'],
    summary: 'Espèces, carte, mixte, virement ou ardoise : le ticket fiscal est émis à la validation.',
    blocks: [
      { t: 'steps', items: [
        'Ouvrez la commande et touchez « Encaisser ».',
        'Choisissez le moyen de paiement.',
        'Validez. Le ticket fiscal est émis à ce moment et s’imprime.',
      ] },
      { t: 'ul', items: [
        'Espèces : tapez le « Montant reçu » (ou « Exact »). La caisse affiche « À rendre ». Si le client laisse la monnaie, cochez qu’elle est laissée en pourboire.',
        'Carte : le montant part sur le terminal, le client présente sa carte, puis vous validez. Si la banque refuse ou si le terminal ne répond pas, utilisez « Réessayer », tapez le montant directement sur le terminal, ou encaissez en espèces.',
        'Mixte : une partie en espèces, le reste par carte.',
        'Virement : vérifiez la réception du virement, puis validez.',
        'Ardoise : le client paie plus tard (il doit être associé à la commande). Le ticket est émis maintenant ; il règle ensuite depuis Rapports > Ardoises.',
      ] },
      { t: 'p', text: 'Facture pour un client professionnel : cochez « Facture avec ICE », puis saisissez la raison sociale et l’ICE (15 chiffres).' },
      { t: 'p', text: 'Acompte : si le client a versé un acompte, la caisse propose de le déduire de l’addition (« Déduire l’acompte » ou « Ne pas déduire »).' },
      { t: 'warn', text: 'Ardoise : si le client a atteint son plafond, la caisse refuse. Encaissez autrement, ou faites d’abord régler une partie de l’ardoise. Le gérant autorise l’ardoise dans « Clients ».' },
      { t: 'tip', text: 'Sans connexion internet, vous pouvez encaisser : le ticket fiscal est émis automatiquement au retour d’internet (voir l’onglet Historique).' },
    ],
  },
  {
    id: 'till-split', chapter: 'till', title: 'Partager l’addition', products: ['pos'],
    keywords: ['partager', 'diviser', 'séparer', 'parts égales', 'chacun', 'personnes', 'addition', 'split'],
    summary: 'En parts égales, ou chacun paie ses articles avec son propre ticket.',
    blocks: [
      { t: 'ul', items: [
        'En parts égales : indiquez le nombre de personnes ; le montant est arrondi au dirham et le dernier paie le reste.',
        'Par article : choisissez ce que chaque personne paie. Elle reçoit son propre ticket ; le reste reste sur la table.',
      ] },
      { t: 'p', text: 'Pour encaisser les parts, touchez « Encaisser cette part » pour chaque personne. À la fin, la table se libère.' },
      { t: 'warn', text: 'Si une remise est appliquée à l’addition, partagez avant la remise, ou encaissez le total.' },
    ],
  },
  {
    id: 'till-discount', chapter: 'till', title: 'Remises, annulations et validation manager', products: ['pos'],
    keywords: ['remise', 'réduction', 'annuler', 'annulation', 'offert', 'motif', 'manager', 'code manager', 'code promo', 'fidélité', 'cagnotte', 'supprimer'],
    summary: 'Les actions sensibles demandent un motif et le code d’un manager.',
    blocks: [
      { t: 'p', text: 'Pour protéger votre caisse, une remise, l’annulation d’une commande ou le retrait d’un article déjà envoyé demandent :' },
      { t: 'ul', items: ['un motif, obligatoire ;', 'le code personnel d’un manager (« Validation manager »).'] },
      { t: 'p', text: 'En pratique : touchez « Remise » (ou « Annuler la commande »), saisissez le motif, puis faites valider par le manager. Pour une remise, la caisse affiche le nouveau total avant de confirmer.' },
      { t: 'ul', items: [
        'Code promo : touchez « Code promo » et scannez ou tapez le code du client. Un code inconnu est signalé.',
        'Fidélité : si le client est associé et a une cagnotte, vous pouvez l’utiliser. Si elle couvre toute l’addition, « Rien à payer ».',
      ] },
      { t: 'warn', text: 'Annuler un article déjà envoyé en cuisine demande la validation d’un manager et une connexion internet.' },
    ],
  },
  {
    id: 'till-history', chapter: 'till', title: 'Historique, duplicata et avoir (remboursement)', products: ['pos'],
    keywords: ['historique', 'ticket', 'duplicata', 'réimprimer', 'avoir', 'remboursement', 'rembourser', 'erreur', 'corriger', 'note de crédit'],
    summary: 'Retrouver un ticket du jour, le réimprimer, ou émettre un avoir.',
    blocks: [
      { t: 'p', text: 'L’onglet « Historique » liste les tickets du jour : numéro, heure, serveur, paiement, remise, TVA et total TTC.' },
      { t: 'steps', items: [
        'Touchez un ticket.',
        '« Duplicata » le réimprime.',
        '« Avoir (remboursement) » annule entièrement le ticket : saisissez le motif (obligatoire) et faites valider par un manager.',
        'Remboursez le client avec le même moyen de paiement que celui utilisé.',
      ] },
      { t: 'warn', text: 'Un ticket émis ne se modifie jamais : toute correction passe par un avoir. C’est la règle fiscale, et elle protège votre comptabilité.' },
    ],
  },
  {
    id: 'till-reports', chapter: 'till', title: 'Rapport X, caisse et clôture de journée (Z)', products: ['pos'],
    keywords: ['rapport', 'x', 'z', 'clôture', 'clôturer', 'fond de caisse', 'espèces', 'sortie de caisse', 'tiroir', 'ardoises', 'chiffre d’affaires', 'ca', 'comptage', 'journée'],
    summary: 'Suivre le chiffre du jour, gérer l’argent en caisse et clôturer.',
    blocks: [
      { t: 'p', text: 'L’onglet « Caisse & rapports » montre le chiffre d’affaires TTC de la journée, la répartition par moyen de paiement, les avoirs, les ardoises et les acomptes.' },
      { t: 'ul', items: [
        'Fond de caisse : l’argent mis dans la caisse au départ.',
        'Sortie de caisse : un retrait (courses, par exemple), avec son motif. Il ne compte pas dans le chiffre d’affaires, mais réduit les espèces attendues.',
        'Ouvrir le tiroir : ouvre le tiroir-caisse.',
        'Ardoises : encaisser ce qu’un client doit.',
      ] },
      { t: 'steps', items: [
        'Pour clôturer, touchez « Clôturer la journée (Z) ».',
        'Comptez les espèces dans la caisse et saisissez le montant (billets et pièces, fond de caisse compris).',
        'La caisse affiche les espèces attendues en caisse ; après validation, le rapport Z s’imprime.',
      ] },
      { t: 'warn', text: 'La clôture est définitive : après elle, plus aucune vente n’est possible sur cette journée. Encaissez ou annulez d’abord toutes les commandes ouvertes, et attendez que les opérations en attente soient envoyées (voir Synchronisation).' },
      { t: 'tip', text: 'Si vous avez oublié de clôturer hier, la caisse vous le rappelle en rouge. Pas de comptage des espèces dans ce cas : l’argent d’aujourd’hui est déjà dans la caisse.' },
    ],
  },
  {
    id: 'till-kitchen', chapter: 'till', title: 'L’écran cuisine', products: ['pos'],
    keywords: ['cuisine', 'écran', 'bon', 'prêt', 'servi', 'rappeler', 'passe', 'station', 'bar', 'imprimante', 'ticket cuisine'],
    summary: 'Un poste qui affiche les bons à préparer, sans code personnel.',
    blocks: [
      { t: 'p', text: 'Un poste peut devenir « Écran cuisine ». Choisissez ce qu’il montre :' },
      { t: 'ul', items: [
        'Un poste : les bons à préparer de ses stations (par exemple cuisine ou bar).',
        'Le passe : toutes les stations, avec ce qui est prêt à servir, table par table.',
      ] },
      { t: 'p', text: 'Pour chaque bon : touchez « Prêt » quand le plat est terminé, puis « Servi » quand il a été servi. Les allergies et notes sont mises en évidence. « Rappeler » ramène un bon par erreur. Pour revenir à une caisse normale, « Quitter l’écran cuisine ».' },
      { t: 'tip', text: 'Les imprimantes (ticket, bar, cuisine) se choisissent dans « Réglages du poste » > « Rechercher les imprimantes », puis « Test ».' },
    ],
  },
  {
    id: 'till-offline', chapter: 'till', title: 'Travailler sans internet', products: ['pos'],
    keywords: ['hors ligne', 'offline', 'internet', 'connexion', 'coupure', 'synchronisation', 'wifi', 'panne', 'envoi'],
    summary: 'La caisse continue de fonctionner et envoie tout au retour de la connexion.',
    blocks: [
      { t: 'p', text: 'Si internet tombe, la caisse continue : vous pouvez prendre des commandes, imprimer les bons, encaisser. Tout est gardé sur le poste et part automatiquement au retour de la connexion.' },
      { t: 'steps', items: [
        'Un message « Hors ligne » s’affiche en haut de la caisse.',
        'Continuez à travailler normalement.',
        'Au retour d’internet, ouvrez « Synchronisation » pour voir l’envoi en cours. Quand tout est parti : « Connecté : tout est envoyé. »',
      ] },
      { t: 'warn', text: 'Ne videz pas le navigateur tant que des opérations sont en attente : elles seraient perdues. Quelques actions demandent internet : validation manager pour un article déjà envoyé en cuisine, réservations, historique, pointage.' },
      { t: 'tip', text: 'Si une opération est refusée par le serveur, la caisse l’indique dans « Synchronisation » : « Réessayer » ou « Ignorer ».' },
    ],
  },
];

const MENU: Article[] = [
  {
    id: 'menu-categories', chapter: 'menu', title: 'Les catégories',
    keywords: ['catégorie', 'boissons', 'plats', 'ordre', 'monter', 'descendre', 'masquer', 'imprimante', 'préparé à', 'service', 'suite', 'entrée', 'emporter', 'icône'],
    summary: 'Organiser votre carte, choisir l’imprimante et les services.',
    blocks: [
      { t: 'p', text: 'Ouvrez la page « Menu ». Commencez par créer une catégorie (Boissons, Plats…) avec « Ajouter ». Chaque catégorie peut être modifiée, masquée, ou déplacée avec « Monter » et « Descendre ».' },
      { t: 'p', text: 'Dans la fenêtre d’une catégorie, vous réglez :' },
      { t: 'ul', items: [
        'Icône : l’image qui accompagne la catégorie.',
        'Préparé à : détermine sur quelle imprimante le bon est envoyé (cuisine, bar…).',
        'Service : les plats d’un service suivant attendent à la caisse, on les envoie avec « Envoyer la suite ». Choisissez « Envoyé tout de suite » pour les autres.',
        'À emporter : moins cher de (DH) : réduit le prix de chaque article de la catégorie quand la commande est à emporter. Exemple : 1 pour des boissons à 1 DH de moins. 0 = même prix.',
        'Visible sur le menu et la caisse : décochez pour la masquer.',
      ] },
    ],
  },
  {
    id: 'menu-items', chapter: 'menu', title: 'Ajouter et modifier un article',
    keywords: ['article', 'plat', 'prix', 'photo', 'description', 'taille', 'options', 'glovo', 'poids', 'balance', 'code-barres', 'scanner', 'visible', 'supprimer'],
    summary: 'Nom, prix, photo, tailles, vente au poids, code-barres, prix Glovo.',
    blocks: [
      { t: 'steps', items: [
        'Choisissez une catégorie puis touchez « Ajouter un article ».',
        'Renseignez le nom, la description, la catégorie et le prix (MAD). Ajoutez une photo : elle fait toute la différence sur le menu QR.',
        'Enregistrez. L’article est tout de suite visible sur la caisse et sur le menu des clients.',
      ] },
      { t: 'ul', items: [
        'Tailles / options (facultatif) : par exemple S, M, L, chacune avec son prix. Avec des options, le client doit en choisir une.',
        'Prix Glovo : un prix différent pour Glovo, par article ou par option. Laissé vide, il est calculé automatiquement (prix du restaurant + réglage Glovo du menu).',
        'Vendu au poids (gâteaux secs, chocolats…) : la caisse demande le poids lu sur la balance et calcule le prix. Pas de commande en ligne pour cet article.',
        'Code-barres : le scanner de la caisse ajoute l’article. Pour une balance, saisissez le numéro d’article qu’elle imprime dans ses étiquettes (3 à 32 caractères : chiffres, lettres ou tiret).',
      ] },
      { t: 'tip', text: 'Pour retrouver un article rapidement, utilisez « Chercher un article » en haut de la page Menu.' },
    ],
  },
  {
    id: 'menu-availability', chapter: 'menu', title: 'Épuisé ou masqué : quelle différence ?',
    keywords: ['épuisé', 'rupture', 'masquer', 'oeil', 'œil', 'disponible', 'afficher', 'stock', 'plus de'],
    summary: 'Deux façons de retirer un article, pour deux situations.',
    blocks: [
      { t: 'ul', items: [
        'Épuisé : l’article reste visible mais n’est plus commandable aujourd’hui. Idéal pour une rupture de stock. Remettez « Disponible » demain.',
        'L’œil (Masquer du menu) : l’article disparaît du menu des clients et de la caisse. Utile pour un plat de saison. Touchez « Afficher » pour le remettre.',
      ] },
    ],
  },
  {
    id: 'menu-modifiers', chapter: 'menu', title: 'Suppléments et formules',
    keywords: ['supplément', 'formule', 'option', 'cuisson', 'boisson', 'groupe', 'choix', 'obligatoire', 'fiche technique', 'sauce', 'extra', 'menu enfant'],
    summary: 'Des groupes de choix (cuisson, suppléments, boisson de la formule) réutilisables sur plusieurs plats.',
    blocks: [
      { t: 'p', text: 'Sur la page Menu, « Suppléments et formules » vous permet de créer des groupes d’options que le client choisit en commandant.' },
      { t: 'steps', items: [
        'Touchez « Nouveau groupe » et donnez-lui un nom.',
        'Choisissez ce que le client fait : des suppléments (facultatif, plusieurs), un choix obligatoire (cuisson, boisson de la formule) ou sur mesure (minimum et maximum).',
        'Ajoutez les options avec « Ajouter une option ». Indiquez le prix en plus (DH), ou laissez vide pour une option gratuite.',
        'Sous « Sur quels plats ? », cochez les plats concernés. Le groupe est réutilisé partout où vous le cochez.',
        'Enregistrez.',
      ] },
      { t: 'tip', text: 'Si vous utilisez Amplify Profit, la « Fiche technique » d’une option indique ce qu’elle ajoute dans l’assiette ; le stock en direct le retire à chaque vente.' },
    ],
  },
  {
    id: 'menu-import', chapter: 'menu', title: 'Importer votre carte (photo, PDF, Excel)',
    keywords: ['importer', 'import', 'photo', 'pdf', 'excel', 'csv', 'xls', 'ancienne caisse', 'modèle', 'ia', 'annuler', 'traduction', 'arabe', 'changer de caisse'],
    summary: 'Votre menu prêt en 2 minutes, sans rien retaper, et annulable.',
    blocks: [
      { t: 'p', text: 'Vous changez de caisse ? Ne retapez pas votre carte. Sur la page Menu, touchez « Importer mon menu » et choisissez la méthode la plus simple :' },
      { t: 'ul', items: [
        'Photo ou PDF de la carte : jusqu’à 6 pages (11 Mo en tout). L’IA lit les articles et les prix, et traduit en arabe. Comptez 20 à 60 secondes ; ne fermez pas la fenêtre.',
        'Fichier Excel ou CSV : l’export de votre ancienne caisse. Les colonnes sont reconnues automatiquement. Pas d’export ? Téléchargez le modèle Excel à remplir.',
      ] },
      { t: 'steps', items: [
        'Choisissez le fichier ou les photos.',
        'Si les colonnes sont mal reconnues, indiquez ce que contient chaque colonne (il faut au moins un nom et un prix).',
        'Vérifiez l’écran de contrôle : prix, catégories, traductions. Corrigez ou décochez les lignes douteuses.',
        'Touchez « Importer … articles ». Tout est importé d’un coup.',
      ] },
      { t: 'tip', text: 'Un plat qui existe déjà dans la même catégorie est ignoré. Vous vous êtes trompé ? « Annuler cet import » (ou dans « Imports précédents ») : les plats déjà vendus sont masqués plutôt que supprimés.' },
      { t: 'warn', text: 'Ancien format Excel (.xls) : ouvrez-le dans Excel et enregistrez-le en .xlsx ou CSV. Pour la photo : une image nette, bien éclairée, prise de face, donne de bien meilleurs résultats. Vérifiez toujours les prix lus par l’IA.' },
    ],
  },
  {
    id: 'menu-tables', chapter: 'menu', title: 'Tables et QR codes', products: ['pos', 'orders'],
    keywords: ['table', 'qr', 'code', 'imprimer', 'zone', 'terrasse', 'salle', 'zip', 'png', 'svg', 'nouveau qr', 'abîmé', 'chevalet', 'plastifier', 'qr unique', 'sur place'],
    summary: 'Créer vos tables, imprimer les QR codes, ou utiliser un QR unique.',
    blocks: [
      { t: 'p', text: 'Chaque table a son propre QR code : le client qui le scanne commande directement pour cette table. Collez les QR codes sur les tables (idéalement plastifiés).' },
      { t: 'steps', items: [
        'Ouvrez « Tables & QR codes » puis « Ajouter des tables ».',
        'Indiquez « De la table n° » et « À la table n° », et une zone si vous voulez (Terrasse, Salle, Étage). Les numéros déjà existants sont ignorés.',
        'Pour une table avec un nom (ex. « Bar 1 »), créez-la puis renommez-la.',
        '« Imprimer tous les QR codes » (6 par page A4) ou « Tout télécharger (zip) ». Chaque QR code se télécharge aussi en PNG ou SVG pour vos propres supports (cartes, chevalets, autocollants).',
      ] },
      { t: 'ul', items: [
        'Active (commandes possibles) : décochez pour empêcher les commandes sur une table.',
        'Générer un nouveau QR code : à utiliser si un QR code a été copié ou abîmé. L’ancien code collé sur la table ne fonctionnera plus.',
        'QR code unique du restaurant : un seul modèle pour toutes les tables. Le client scanne, choisit « Sur place » et tape son numéro de table, qui doit correspondre à une table de la liste. Les QR codes par table continuent de fonctionner.',
      ] },
    ],
  },
];

export const ARTICLES: Article[] = [...START, ...TILL, ...MENU];
