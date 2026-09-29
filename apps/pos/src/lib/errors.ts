// Database error codes (see supabase/migrations) to French messages for staff.
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
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(msg)) return M.invalid_login;
  if (/fetch|network|Failed to fetch|NetworkError|timeout/i.test(msg)) return M.network;
  const key = Object.keys(M).find(k => msg === k || msg.startsWith(k));
  return key ? M[key] : `Erreur : ${msg}`;
}
export const PIN_ERRORS: Record<string, string> = {
  invalid: 'Code incorrect.',
  locked: 'Trop d\'essais. Réessayez dans 5 minutes.',
  not_manager: 'Un code manager est nécessaire.',
};
