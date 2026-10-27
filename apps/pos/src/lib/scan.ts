// Barcode scanner at the till (an option of the shop, off by default: restaurants.barcode_scan).
// A USB or bluetooth scanner types the code like a keyboard, very fast, and ends with Enter.
import { useEffect, useRef } from 'react';

/** Calls onCode with what a scanner typed while the person is NOT typing in a field. Does nothing while enabled is false. */
export function useKeyboardScanner(enabled: boolean, onCode: (code: string) => void) {
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    if (!enabled) return;
    let buf = ''; let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // a field has the focus: the person is typing (the scan field has its own Enter)
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) { buf = ''; return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        // the Enter that ends a scan must not press the button that has the focus
        if (buf.length >= 4) { e.preventDefault(); e.stopPropagation(); cb.current(buf); }
        buf = ''; return;
      }
      if (e.key.length !== 1) return;
      const now = Date.now();
      if (now - last > 100) buf = '';          // scanners type a whole code in a few milliseconds; people are slower
      last = now; buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}

/** Can this device read barcodes with its camera? (Chrome on Android and desktop; not Safari/iPhone.) */
export const cameraScanSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
