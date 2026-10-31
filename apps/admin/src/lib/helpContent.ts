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

export const ARTICLES: Article[] = [...START];
