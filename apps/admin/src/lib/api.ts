import { supabase } from './supabase';
import { getLang, t } from './i18n';

type R<T> = { data: T | null; error: { message: string; details?: string | null } | null };
export function check<T>(r: R<T>): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { details: r.error.details });
  return r.data as T;
}
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return check(await supabase.rpc(fn, args)) as T;
}

// French messages, shown through t()
// i18n:values
const M: Record<string, string> = {
  'not allowed': "Vous n'avez pas les droits pour cette action.",
  'restaurant is paused or trial has ended': "Abonnement suspendu ou essai terminé : modifications impossibles.",
  invalid_pin_format: 'Le code doit contenir 4 à 6 chiffres.',
  user_not_found: "Aucun compte avec cet e-mail. Créez-le d'abord dans Supabase (Authentication > Users).",
  only_demo_restaurants_can_be_purged: 'Seuls les restaurants de démonstration peuvent être supprimés.',
  network: 'Pas de connexion internet.',
  slug_taken: 'Cette adresse est déjà prise.',
  too_many_restaurants: 'Limite de 3 restaurants par compte atteinte. Contactez-nous.',
  name_required: 'Indiquez le nom du restaurant.',
  cannot_remove_yourself: 'Vous ne pouvez pas retirer votre propre accès.',
  'customer has an open balance': "Ce client a encore une ardoise ouverte : soldez-la (ou corrigez le solde) avant de le supprimer.",
  reason_required: 'Indiquez un motif.',
  tips_already_shared: 'Cette période a déjà été partagée (en tout ou en partie).',
  no_hours: 'Personne n’a pointé sur cette période.',
};
// i18n:end
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/captcha/i.test(msg)) return t('Vérification anti-robot échouée. Réessayez dans un instant.');
  if (/Invalid login credentials/i.test(msg)) return t('E-mail ou mot de passe incorrect.');
  if (/already registered|already been registered/i.test(msg)) return t('Un compte existe déjà avec cet e-mail : connectez-vous.');
  if (/Password should be/i.test(msg)) return t('Mot de passe trop court (8 caractères minimum).');
  if (/Email not confirmed/i.test(msg)) return t("Confirmez d'abord votre e-mail (lien reçu par e-mail).");
  if (/fetch|network/i.test(msg)) return t(M.network);
  if (/duplicate key.*restaurants_slug/i.test(msg)) return t('Cette adresse (slug) est déjà prise.');
  if (/duplicate key.*(label|name)/i.test(msg)) return t('Ce nom existe déjà.');
  if (/violates foreign key.*menu_items/i.test(msg) || /menu_items_restaurant_id_category_id_fkey/i.test(msg)) return t("Cette catégorie contient encore des articles : déplacez-les ou supprimez-les d'abord.");
  if (/restaurants_slug_check/i.test(msg)) return t("Adresse invalide : lettres minuscules, chiffres et tirets (3 à 40 caractères).");
  if (/restaurants_ice_check/i.test(msg)) return t("L'ICE doit contenir exactement 15 chiffres.");
  const k = Object.keys(M).find(x => msg === x || msg.startsWith(x));
  return k ? t(M[k]) : t('Erreur : {m}', { m: msg });
}

/** Screen amounts. Western digits in both languages (as used in Morocco). */
export const mad = (c: number) => {
  const v = (Number(c) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  // Arabic: isolate the number (LRI...PDI) so a minus sign stays on the left of the digits
  return getLang() === 'ar' ? `\u2066${v}\u2069 درهم` : `${v} MAD`;
};
export const toCents = (s: string) => Math.round((Number(String(s).replace(',', '.')) || 0) * 100);
export const fromCents = (c: number | null | undefined) => (c == null ? '' : String(Number(c) / 100).replace('.', ','));
export const token = (n = 10) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map(x => a[x % 32]).join('');
};
