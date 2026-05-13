import { Smartphone } from 'lucide-react';
import { useT } from '@/i18n/strings';

export default function PhonePage() {
  const t = useT();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <h1 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">Phone</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
        <Smartphone size={56} className="mb-4 opacity-30" />
        <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
          Phone Control
        </h2>
        <p className="text-[13px] text-center max-w-xs">
          Phone screen control will be available in a future update.
        </p>
      </div>
    </div>
  );
}
