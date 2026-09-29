import { supabase } from './supabase';

type R<T> = { data: T | null; error: { message: string; details?: string | null } | null };
export function check<T>(r: R<T>): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { details: r.error.details });
  return r.data as T;
}
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return check(await supabase.rpc(fn, args)) as T;
}

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
};
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already been registered/i.test(msg)) return 'Un compte existe déjà avec cet e-mail : connectez-vous.';
  if (/Password should be/i.test(msg)) return 'Mot de passe trop court (8 caractères minimum).';
  if (/Email not confirmed/i.test(msg)) return "Confirmez d'abord votre e-mail (lien reçu par e-mail).";
  if (/fetch|network/i.test(msg)) return M.network;
  if (/duplicate key.*restaurants_slug/i.test(msg)) return 'Cette adresse (slug) est déjà prise.';
  if (/duplicate key.*(label|name)/i.test(msg)) return 'Ce nom existe déjà.';
  if (/violates foreign key.*menu_items/i.test(msg) || /menu_items_restaurant_id_category_id_fkey/i.test(msg)) return "Cette catégorie contient encore des articles : déplacez-les ou supprimez-les d'abord.";
  if (/restaurants_slug_check/i.test(msg)) return "Adresse invalide : lettres minuscules, chiffres et tirets (3 à 40 caractères).";
  if (/restaurants_ice_check/i.test(msg)) return "L'ICE doit contenir exactement 15 chiffres.";
  const k = Object.keys(M).find(x => msg === x || msg.startsWith(x));
  return k ? M[k] : `Erreur : ${msg}`;
}

export const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 })} MAD`;
export const toCents = (s: string) => Math.round((Number(String(s).replace(',', '.')) || 0) * 100);
export const fromCents = (c: number | null | undefined) => (c == null ? '' : String(Number(c) / 100).replace('.', ','));
export const token = (n = 10) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map(x => a[x % 32]).join('');
};
