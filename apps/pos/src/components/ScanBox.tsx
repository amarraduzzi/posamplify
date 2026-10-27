// The scan field of the till (only when the shop switched the scanner on): type or paste a code, or read it with the camera.
import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import { t } from '../lib/i18n';
import { cameraScanSupported } from '../lib/scan';
import { Btn, Modal, inputCls } from './ui';

interface Detected { rawValue?: string }
interface Detector { detect: (v: HTMLVideoElement) => Promise<Detected[]> }

function CameraScan({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stop = false; let timer = 0; let stream: MediaStream | null = null;
    (async () => {
      try {
        const BD = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop) { stream.getTracks().forEach(x => x.stop()); return; }
        const v = video.current!;
        v.srcObject = stream; await v.play();
        const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39'] });
        const tick = async () => {
          if (stop) return;
          try { const r = await det.detect(v); if (r[0]?.rawValue) { navigator.vibrate?.(40); cb.current(r[0].rawValue); return; } } catch { /* next picture */ }
          timer = window.setTimeout(tick, 200);
        };
        void tick();
      } catch { setErr(t('La caméra n’est pas accessible. Autorisez-la dans le navigateur, ou utilisez un scanner.')); }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach(x => x.stop()); };
  }, []);
  return (
    <Modal title={t('Scanner avec la caméra')} onClose={onClose} footer={<div className="flex justify-end"><Btn onClick={onClose}>{t('Fermer')}</Btn></div>}>
      {err ? <p className="font-semibold text-danger">{err}</p> : <>
        <video ref={video} playsInline muted className="aspect-[4/3] w-full rounded-2xl bg-black object-cover" />
        <p className="mt-2 text-sm text-muted">{t('Placez le code-barres devant la caméra.')}</p>
      </>}
    </Modal>
  );
}

export function ScanBox({ onCode, className = '' }: { onCode: (c: string) => void; className?: string }) {
  const [val, setVal] = useState('');
  const [cam, setCam] = useState(false);
  const submit = () => { const c = val.trim(); if (c) { onCode(c); setVal(''); } };
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative min-w-0 flex-1">
        <ScanBarcode className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input dir="ltr" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={t('Scanner un code-barres')} inputMode="text" aria-label={t('Scanner un code-barres')} className={`${inputCls} py-2 ps-9`} />
      </div>
      {cameraScanSupported() && <Btn tone="ghost" className="shrink-0 px-3 py-2" aria-label={t('Scanner avec la caméra')} onClick={() => setCam(true)}><Camera className="h-4 w-4" /></Btn>}
      {cam && <CameraScan onClose={() => setCam(false)} onCode={c => { setCam(false); onCode(c); }} />}
    </div>
  );
}
