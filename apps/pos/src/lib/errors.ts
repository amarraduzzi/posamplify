// Database error codes (see supabase/migrations) to messages for staff (French key, translated by t()).
import { t } from './i18n';
// i18n:values
const M: Record<string, string> = {
  not_allowed: "Action non autorisée pour ce compte.",
  'not allowed': "Action non autorisée pour ce compte.",
  'restaurant is paused or trial has ended': "Abonnement suspendu ou essai terminé. Contactez le support.",
  payment_mismatch: "Le montant payé ne correspond pas au total.",
  order_already_closed: "Cette commande est déjà encaissée.",
  order_not_open: "Cette commande n'est plus ouverte.",
  order_empty: "La commande est vide.",
  order_cancelled: "Cette commande est annulée.",
  order_closed_use_credit_note: "Commande encaissée : faites un avoir depuis l'historique.",
  remove_payments_first: "Supprimez d'abord les paiements de cette commande.",
  not_enough_points: "Pas assez de points pour la récompense.",
  order_too_small: "La commande doit dépasser la valeur de la récompense.",
  customers_off: "Le fichier clients n'est pas activé (espace gérant > Clients).",
  loyalty_off: "Les points de fidélité ne sont pas activés.",
  invalid_phone: "Numéro de téléphone invalide.",
  credit_off: "L'ardoise n'est pas activée (espace gérant > Clients).",
  credit_not_allowed: "Ce client n'a pas droit à l'ardoise. Le gérant peut l'autoriser dans Clients.",
  credit_limit: "Plafond de l'ardoise dépassé pour ce client.",
  no_customer: "Associez d'abord un client à la commande.",
  more_than_balance: "Le montant dépasse ce que le client doit.",
  remove_discount_first: "Une remise est appliquée : encaissez le total, ou retirez la remise avant de partager.",
  'modifier choice required': "Choisissez les options obligatoires de cet article.",
  'modifier not available': "Une option de cet article n'est plus disponible. Reprenez l'article.",
  reason_required: "Indiquez un motif.",
  invalid_amount: "Montant invalide.",
  day_closed: "La journée est clôturée (Z). Plus aucune vente possible aujourd'hui.",
  open_orders: "Il reste des commandes ouvertes. Encaissez-les ou annulez-les d'abord.",
  already_credited: "Un avoir existe déjà pour ce ticket.",
  invalid_buyer: "ICE du client invalide (15 chiffres).",
  invalid_pin_format: "Le code doit contenir 4 à 6 chiffres.",
  invalid_login: "E-mail ou mot de passe incorrect.",
  network: "Pas de connexion internet. Réessayez.",
};
// i18n:end
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/captcha/i.test(msg)) return t('Vérification anti-robot échouée. Réessayez dans un instant.');
  if (/Invalid login credentials/i.test(msg)) return t(M.invalid_login);
  if (/fetch|network|Failed to fetch|NetworkError|timeout/i.test(msg)) return t(M.network);
  const key = Object.keys(M).find(k => msg === k || msg.startsWith(k));
  return key ? t(M[key]) : t('Erreur : {m}', { m: msg });
}
// i18n:values
const PIN_FR: Record<string, string> = {
  invalid: 'Code incorrect.',
  locked: 'Trop d\'essais. Réessayez dans 5 minutes.',
  not_manager: 'Un code manager est nécessaire.',
};
// i18n:end
/** PIN error messages in the till's language. */
export const PIN_ERRORS: Record<string, string> = new Proxy(PIN_FR, {
  get: (o, k) => (typeof k === 'string' && o[k] ? t(o[k]) : undefined),
});
