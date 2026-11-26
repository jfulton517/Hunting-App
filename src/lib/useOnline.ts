import { useEffect, useState } from 'react';

/** Whether the phone reports a network connection (false = definitely offline). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Whether the app's files are saved for offline use (service worker in control). */
export function useAppCached(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setReady(false);
      return;
    }
    const check = () => setReady(!!navigator.serviceWorker.controller);
    check();
    navigator.serviceWorker.ready.then(check).catch(() => setReady(false));
    navigator.serviceWorker.addEventListener('controllerchange', check);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', check);
  }, []);
  return ready;
}
