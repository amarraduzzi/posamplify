// For a restaurant that only has Amplify Site: its subscription (paid by transfer or CashPlus,
// arranged on WhatsApp with Amplify) and what Amplify POS and Amplify Profit add.
// Upgrades are switched on by Amplify (Plateforme), so every step is a WhatsApp message to us.
import { Check, MessageCircle, ReceiptText, ShoppingBag, TrendingUp, Globe } from 'lucide-react';
import { SITE_URL } from '../lib/supabase';
import { dateLocale, t } from '../lib/i18n';
import type { Restaurant } from '../lib/types';
import { Card } from '../components/ui';

/** Amplify's own WhatsApp (international digits, for wa.me). */
export const AMPLIFY_WA = '212660353741';
const wa = (text: string) => `https://wa.me/${AMPLIFY_WA}?text=${encodeURIComponent(text)}`;

export function UpgradePage({ r }: { r: Restaurant }) {
  const site = r.site?.domain ? `https://${r.site.domain}` : `${SITE_URL}/${r.slug}`;
  const ends = r.trial_ends_at ? new Date(r.trial_ends_at) : null;
  const daysLeft = ends ? Math.ceil((ends.getTime() - Date.now()) / 86400000) : null;
  const ask = (what: string) => wa(`${what}\n${r.name} (${site})`);
  // i18n:values
  const products = [
    { Icon: ShoppingBag, name: 'Amplify POS', text: 'Les commandes de votre site arrivent directement en caisse, sans WhatsApp à recopier.', points: ['Commande en ligne sans commission', 'Menu QR : vos clients commandent à table', 'Caisse, cuisine, livraison et réservations', 'Vos ventes du jour sur votre téléphone'], msg: 'Bonjour Amplify, je veux essayer Amplify POS avec mon site.' },
    { Icon: TrendingUp, name: 'Amplify Profit', text: 'Sachez ce que chaque plat vous rapporte vraiment.', points: ['La marge de chaque plat', 'Stock et achats fournisseurs', 'Charges et résultat du mois'], msg: 'Bonjour Amplify, je veux essayer Amplify Profit.' },
  ];
  // i18n:end
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">{t('Abonnement')}</h1>
        <p className="text-muted">{t('Votre site, et ce que vous pouvez ajouter quand vous êtes prêt.')}</p>
      </div>

      <Card className="night !text-white">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/20 text-brand"><Globe className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl font-semibold">Amplify Site</p>
            <p className="text-white/70">
              {r.status === 'active' ? t('Votre abonnement est actif.')
                : r.status === 'trial' && daysLeft != null && daysLeft > 0 ? t('Essai gratuit : encore {n} jour(s), jusqu’au {d}.', { n: daysLeft, d: ends!.toLocaleDateString(dateLocale()) })
                : t('Votre essai est terminé. Votre site est en pause jusqu’au paiement.')}
            </p>
            <ul className="mt-4 grid gap-2 text-sm text-white/85 sm:grid-cols-2">
              {[t('Votre site sur Google, en 3 langues'), t('Votre carte à jour, avec photos'), t('Commandes sur WhatsApp'), t('Hébergement et mises à jour compris')].map(x => (
                <li key={x} className="flex items-center gap-2"><Check className="h-4 w-4 text-brand" />{x}</li>
              ))}
            </ul>
          </div>
          <div className="text-end">
            <p className="font-display text-4xl font-semibold">100 DH</p>
            <p className="text-sm text-white/60">{t('par mois')}</p>
          </div>
        </div>
        {r.status !== 'active' && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
            <a href={ask(t('Bonjour Amplify, je veux garder mon site. Comment payer ?'))} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 font-semibold text-[#063B1E]"><MessageCircle className="h-4 w-4" /> {t('Garder mon site')}</a>
            <p className="text-sm text-white/60">{t('Paiement par virement ou CashPlus. Nous activons votre site dès réception.')}</p>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <ReceiptText className="h-6 w-6 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('Votre propre nom de domaine')}</p>
            <p className="text-sm text-muted">{t('Par exemple www.monrestaurant.ma. Nous relions le domaine que vous avez déjà à votre site : 150 DH, une seule fois.')}</p>
          </div>
          <a href={ask(t('Bonjour Amplify, je veux relier mon nom de domaine à mon site.'))} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold"><MessageCircle className="h-4 w-4" /> {t('Demander')}</a>
        </div>
      </Card>

      <div>
        <h2 className="font-display text-2xl font-semibold">{t('Aller plus loin')}</h2>
        <p className="text-muted">{t('Votre site et votre menu restent les mêmes. Essai gratuit de 14 jours, sans engagement.')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {products.map(p => (
          <Card key={p.name} className="flex flex-col">
            <p.Icon className="h-7 w-7 text-brand" />
            <p className="mt-3 font-display text-2xl font-semibold">{p.name}</p>
            <p className="mt-1 text-muted">{t(p.text)}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {p.points.map(x => <li key={x} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{t(x)}</li>)}
            </ul>
            <a href={ask(t(p.msg))} target="_blank" rel="noopener" className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-semibold text-brand-ink"><MessageCircle className="h-4 w-4" /> {t('Essayer 14 jours gratuits')}</a>
          </Card>
        ))}
      </div>
    </div>
  );
}
