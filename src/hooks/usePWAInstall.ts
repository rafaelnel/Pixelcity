import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

// Capture beforeinstallprompt early at module load so React never misses it
let capturedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(event: BeforeInstallPromptEvent | null) => void>();

function notifyPromptListeners(event: BeforeInstallPromptEvent | null) {
  capturedDeferredPrompt = event;
  for (const listener of promptListeners) {
    listener(event);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    notifyPromptListeners(e as BeforeInstallPromptEvent);
  });

  window.addEventListener('appinstalled', () => {
    notifyPromptListeners(null);
  });
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
    !(window as Window & { MSStream?: unknown }).MSStream
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => capturedDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectStandalone());
  const [isIOS] = useState<boolean>(() => detectIOS());

  useEffect(() => {
    const syncStandalone = () => setIsInstalled(detectStandalone());
    syncStandalone();

    const mql = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => syncStandalone();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleDisplayChange);
    }

    const handlePromptChange = (event: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(event);
    };
    promptListeners.add(handlePromptChange);
    setDeferredPrompt(capturedDeferredPrompt);

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      promptListeners.delete(handlePromptChange);
      window.removeEventListener('appinstalled', handleInstalled);
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleDisplayChange);
      }
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvent = deferredPrompt ?? capturedDeferredPrompt;
    if (!promptEvent) return 'unavailable';
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      notifyPromptListeners(null);
      setIsInstalled(true);
    }
    return outcome;
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
