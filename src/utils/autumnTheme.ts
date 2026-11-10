import { useCallback, useEffect, useState } from 'react';

export const AUTUMN_THEME_STORAGE_KEY = 'kiberone_autumn_theme';
export const AUTUMN_THEME_CHANGE_EVENT = 'kiberone:autumn-theme-changed';
export const AUTUMN_LEAF_BURST_EVENT = 'kiberone:autumn-leaf-burst';

export function getAutumnThemeStored(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const item = localStorage.getItem(AUTUMN_THEME_STORAGE_KEY);
    if (item === null) {
      return true; // Enabled by default on first launch
    }
    return item === 'true';
  } catch {
    return true;
  }
}

export function setAutumnThemeStored(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(AUTUMN_THEME_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(
      new CustomEvent(AUTUMN_THEME_CHANGE_EVENT, { detail: { enabled } })
    );
  } catch {
    // Ignore localStorage write failures
  }
}

export function triggerAutumnLeafBurst(): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTUMN_LEAF_BURST_EVENT));
  } catch {
    // Ignore event dispatch failures
  }
}

export function useAutumnTheme() {
  const [isAutumnTheme, setIsAutumnTheme] = useState<boolean>(() =>
    getAutumnThemeStored()
  );

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      if (customEvent.detail && typeof customEvent.detail.enabled === 'boolean') {
        setIsAutumnTheme(customEvent.detail.enabled);
      } else {
        setIsAutumnTheme(getAutumnThemeStored());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === AUTUMN_THEME_STORAGE_KEY) {
        setIsAutumnTheme(event.newValue === 'true');
      }
    };

    window.addEventListener(AUTUMN_THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTUMN_THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setAutumnTheme = useCallback((enabled: boolean) => {
    setIsAutumnTheme(enabled);
    setAutumnThemeStored(enabled);
  }, []);

  const toggleAutumnTheme = useCallback(() => {
    setAutumnTheme(!isAutumnTheme);
  }, [isAutumnTheme, setAutumnTheme]);

  return {
    isAutumnTheme,
    setAutumnTheme,
    toggleAutumnTheme,
    triggerLeafBurst: triggerAutumnLeafBurst,
  };
}
