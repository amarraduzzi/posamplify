// The WhatsApp messages to clients, in the client's language (kept when they booked or took a place),
// else in the language the salon uses in this screen.
import { getLang } from './i18n';

type L = 'fr' | 'ar' | 'en';
const pick = (l?: string | null): L => (l === 'ar' || l === 'en' || l === 'fr' ? l : getLang());

export function reminderText(l: string | null | undefined, v: { name: string; salon: string; service: string; time: string; link: string }) {
  return {
    fr: `Bonjour ${v.name}, petit rappel de ${v.salon} : votre rendez-vous ${v.service} est demain à ${v.time}. Merci de confirmer ou d’annuler ici : ${v.link}`,
    ar: `مرحبا ${v.name}، تذكير من ${v.salon}: موعدكم ${v.service} غدا على الساعة ${v.time}. المرجو التأكيد أو الإلغاء من هنا: ${v.link}`,
    en: `Hello ${v.name}, a reminder from ${v.salon}: your ${v.service} appointment is tomorrow at ${v.time}. Please confirm or cancel here: ${v.link}`,
  }[pick(l)];
}

export function turnText(l: string | null | undefined, v: { name: string; salon: string; min: number; link: string }) {
  return {
    fr: `Bonjour ${v.name}, c’est bientôt votre tour chez ${v.salon} (environ ${v.min} min). Merci de venir maintenant. Votre place : ${v.link}`,
    ar: `مرحبا ${v.name}، نوبتكم عند ${v.salon} قريبة (حوالي ${v.min} د). المرجو الحضور الآن. نوبتكم: ${v.link}`,
    en: `Hello ${v.name}, your turn at ${v.salon} is coming (about ${v.min} min). Please come now. Your place: ${v.link}`,
  }[pick(l)];
}
