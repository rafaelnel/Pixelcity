import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 left-3 z-50 pixel-panel px-3 py-1.5 flex items-center gap-2 border-[#f59e0b] text-[#fde68a] pointer-events-none select-none"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-[#f59e0b]" aria-hidden="true" />
      <span className="font-pixel text-[8px] tracking-wide">MODO OFFLINE</span>
    </div>
  );
}
