// The card terminal (TPE) of this till. The till sends the amount, the terminal asks for the card and
// answers: approved (with the bank's reference and the last 4 digits) or not. The restaurant signs its
// contract with its bank or the CMI; we only talk to the terminal.
// Today: "test" mode, a terminal simulated in the till (to try the whole flow and to show it). The link
// to a real terminal (protocol Concert, through the print program on Windows or the Android app) plugs
// in behind the same tpePay().
// Kept on this till only (localStorage), like the printers.

export type TpeMode = 'off' | 'test';
/** what the simulated terminal does in test mode */
export type TpeTest = 'approved' | 'declined' | 'unreachable' | 'timeout';
export interface TpeSettings { mode: TpeMode; test: TpeTest }
export interface TpeApproval { status: 'approved'; ref: string; last4: string; brand: string; terminal: string }
/** declined: the bank said no; unreachable: no terminal answers; timeout: no card presented in time */
export type TpeFailure = 'declined' | 'unreachable' | 'timeout' | 'cancelled';
export class TpeError extends Error {
  constructor(public kind: TpeFailure) { super(kind); this.name = 'TpeError'; }
}

const KEY = 'pos-tpe';
export function tpeSettings(): TpeSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<TpeSettings>;
    return { mode: v.mode === 'test' ? 'test' : 'off', test: v.test && ['approved', 'declined', 'unreachable', 'timeout'].indexOf(v.test) >= 0 ? v.test : 'approved' };
  } catch { return { mode: 'off', test: 'approved' }; }
}
export function setTpeSettings(s: TpeSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: stays off */ }
}
export const tpeOn = () => tpeSettings().mode !== 'off';

/** How long the till waits for the customer's card and PIN (Moroccan terminals often take 30 to 60 s). */
export const TPE_WAIT_MS = 90000;

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, ko) => {
  const t = window.setTimeout(ok, ms);
  if (signal) signal.addEventListener('abort', () => { window.clearTimeout(t); ko(new TpeError('cancelled')); }, { once: true });
});

/** The simulated terminal: a few seconds for the card, then the answer chosen in the settings. */
async function testPay(amountCents: number, test: TpeTest, signal?: AbortSignal): Promise<TpeApproval> {
  if (test === 'unreachable') { await wait(700, signal); throw new TpeError('unreachable'); }
  if (test === 'timeout') { await wait(8000, signal); throw new TpeError('timeout'); }
  await wait(2600, signal);
  if (test === 'declined') throw new TpeError('declined');
  const n = String(Math.floor(100000 + Math.random() * 900000));
  return { status: 'approved', ref: `TEST${n}`, last4: String(1000 + (amountCents % 9000)).slice(-4), brand: 'VISA', terminal: 'TPE test' };
}

/** Asks the terminal for amountCents. Resolves when approved; throws a TpeError otherwise. */
export async function tpePay(amountCents: number, signal?: AbortSignal): Promise<TpeApproval> {
  if (!(amountCents > 0) || amountCents % 1 !== 0) throw new Error('invalid amount');
  const s = tpeSettings();
  if (s.mode === 'test') return testPay(amountCents, s.test, signal);
  throw new TpeError('unreachable');
}
