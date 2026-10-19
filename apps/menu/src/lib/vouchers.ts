// The codes a guest got for sharing his story are kept on his phone per restaurant, so he can find
// and show them on his next visit (they are also in the story's confirmation screen).
import { load, save } from './storage';
import type { GuestVoucher } from './api';

const key = (slug: string) => `vouchers:${slug}`;
const today = () => new Date().toLocaleDateString('en-CA');

export const savedVouchers = (slug: string): GuestVoucher[] =>
  (load<GuestVoucher[]>(key(slug), 60 * 86400_000) ?? []).filter(v => v.ends_on >= today());

export function rememberVoucher(slug: string, v: GuestVoucher) {
  save(key(slug), [v, ...savedVouchers(slug).filter(x => x.code !== v.code)].slice(0, 5));
}
