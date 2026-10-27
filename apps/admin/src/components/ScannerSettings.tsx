// Option of the shop, OFF by default: barcodes at the till. The owner switches it on and tells how the shop's scale writes its labels.
// While it is off nothing changes: no scan field in the till, no code field on a product.
import { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { scaleFormatOf, scaleFormatOk, type ScaleFormat, type ScaleValue } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from './ui';

export function ScannerSettings({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const canSwitch = a.isAdmin || a.role === 'owner';
  const f0 = scaleFormatOf(r);
  const [on, setOn] = useState(!!r.barcode_scan);
  const [prefix, setPrefix] = useState(f0.prefix);
  const [codeLen, setCodeLen] = useState(String(f0.codeLen));
  const [valueLen, setValueLen] = useState(String(f0.valueLen));
  const [value, setValue] = useState<ScaleValue>(f0.value);
  const [busy, setBusy] = useState(false);

  const f: ScaleFormat = { prefix, codeLen: Number(codeLen), valueLen: Number(valueLen), value };
  const valid = scaleFormatOk(f);
  const example = valid ? `${prefix} ${'1'.repeat(f.codeLen - 1)}2 ${value === 'weight_g' ? '00450'.padStart(f.valueLen, '0') : value === 'weight_10g' ? '00045'.padStart(f.valueLen, '0') : '09000'.padStart(f.valueLen, '0')} ✓` : '';

  const save = async (patch: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try { check(await supabase.from('restaurants').update(patch).eq('id', r.id)); await a.reload(); a.toast(msg); } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const switchOn = (v: boolean) => { setOn(v); void save({ barcode_scan: v }, v ? t('Le scanner est activé dans la caisse.') : t('Le scanner est désactivé.')); };
  const saveFormat = () => void save({ scale_prefix: prefix, scale_code_len: f.codeLen, scale_value_len: f.valueLen, scale_value: value }, t('Format de la balance enregistré.'));
  const changed = prefix !== f0.prefix || f.codeLen !== f0.codeLen || f.valueLen !== f0.valueLen || value !== f0.value;

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><ScanBarcode className="h-5 w-5 text-brand" /> {t('Scanner et balance')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Option : à activer seulement si vous utilisez un scanner de codes-barres ou une balance qui imprime des étiquettes. Désactivée, rien ne change dans la caisse.')}</p>
      <Toggle checked={on} disabled={!canSwitch || busy} onChange={switchOn} label={t('Activer le scanner dans la caisse')} />
      {!canSwitch && <p className="mt-2 text-sm text-muted">{t('Seul le propriétaire peut activer cette option.')}</p>}
      {on && (
        <div className="mt-5 space-y-4">
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Sur chaque article, un champ « Code-barres » apparaît. Pour un article vendu au poids, indiquez le numéro d’article que la balance imprime dans ses étiquettes. Le scanner USB ou la caméra de la tablette ajoutent alors l’article, avec le poids de l’étiquette.')}</p>
          <p className="text-sm font-semibold">{t('Étiquettes de la balance')}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('Préfixe')} hint={t('Début du code, par exemple 2')}><input dir="ltr" className={inputCls} inputMode="numeric" maxLength={3} value={prefix} disabled={!canSwitch} onChange={e => setPrefix(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Chiffres du numéro d’article')}><input dir="ltr" className={inputCls} inputMode="numeric" value={codeLen} disabled={!canSwitch} onChange={e => setCodeLen(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Chiffres du poids ou du prix')}><input dir="ltr" className={inputCls} inputMode="numeric" value={valueLen} disabled={!canSwitch} onChange={e => setValueLen(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Le code contient')}>
              <select className={inputCls} value={value} disabled={!canSwitch} onChange={e => setValue(e.target.value as ScaleValue)}>
                <option value="weight_g">{t('le poids en grammes')}</option>
                <option value="weight_10g">{t('le poids en dizaines de grammes')}</option>
                <option value="price_cents">{t('le prix en centimes')}</option>
              </select>
            </Field>
          </div>
          {valid
            ? <p className="text-sm text-muted">{t('Exemple de code')} : <b dir="ltr" className="tabular text-ink">{example}</b> · {t('13 chiffres, le dernier est un chiffre de contrôle.')}</p>
            : <p className="text-sm font-semibold text-danger">{t('Préfixe + numéro d’article + poids ou prix doivent faire 12 chiffres (le 13e est le chiffre de contrôle).')}</p>}
          {value === 'price_cents' && <p className="text-sm text-warn">{t('Avec le prix dans le code, le poids est recalculé à partir du prix au kilo : le prix à la caisse peut différer d’un centime de l’étiquette.')}</p>}
          {canSwitch && <Btn tone="brand" disabled={!valid || !changed || busy} onClick={saveFormat}>{t('Enregistrer')}</Btn>}
        </div>
      )}
    </Card>
  );
}
