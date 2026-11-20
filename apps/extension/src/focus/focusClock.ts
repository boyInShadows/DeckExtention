import { useEffect, useState } from 'react';
import { FOCUS_SECOND_MS } from './model';

export function formatFocusCountdown(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / FOCUS_SECOND_MS);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useFocusNow(isRunning: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearInterval(timer);
      timer = undefined;
      setNow(Date.now());
      if (isRunning && !document.hidden)
        timer = window.setInterval(() => setNow(Date.now()), FOCUS_SECOND_MS);
    };
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isRunning]);
  return now;
}
