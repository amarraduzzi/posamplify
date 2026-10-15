// "Installer la caisse": an Amplify Caisse icon on the desktop (Windows) or home screen (Android tablet).
// Only shown when the browser offers it and the till is not installed yet.
import { MonitorDown } from 'lucide-react';
import { useInstall } from '../lib/install';
import { t } from '../lib/i18n';

export function InstallButton({ className = '' }: { className?: string }) {
  const inst = useInstall();
  if (!inst.can) return null;
  return (
    <div className={className}>
      <button type="button" onClick={() => inst.install()}
        className="panel inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold hover:border-brand/60">
        <MonitorDown className="h-4 w-4 text-brand" /> {t('Installer la caisse sur cet appareil')}
      </button>
    </div>
  );
}
