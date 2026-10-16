import { useEffect, useState } from 'react';

/** A phone in the waiter's hand (narrow screen): order-taking layout, payment stays at the till. */
const q = '(max-width: 767px)';
/** the same test outside React */
export const isPhoneNow = () => typeof window !== 'undefined' && window.matchMedia(q).matches;

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}
