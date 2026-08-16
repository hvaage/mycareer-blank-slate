import { useCallback, useEffect, useState } from "react";

/**
 * Husker hvilke kort som er åpne mellom besøk (localStorage).
 * defaultOpen brukes til alle id-er som ikke er lagret ennå.
 */
export function usePersistedCollapse(storageKey: string, defaultOpen: boolean) {
  const [state, setState] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setState(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignorer */
    }
    setHydrated(true);
  }, [storageKey]);

  /** fallback overstyrer defaultOpen for id-er brukeren ikke har rørt. */
  const isOpen = useCallback(
    (id: string, fallback?: boolean) =>
      hydrated && id in state ? state[id]! : (fallback ?? defaultOpen),
    [state, hydrated, defaultOpen],
  );


  const toggle = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { ...prev, [id]: !(id in prev ? prev[id] : defaultOpen) };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignorer */
        }
        return next;
      });
    },
    [storageKey, defaultOpen],
  );

  const setAll = useCallback(
    (ids: string[], open: boolean) => {
      setState(() => {
        const next: Record<string, boolean> = {};
        ids.forEach((id) => (next[id] = open));
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignorer */
        }
        return next;
      });
    },
    [storageKey],
  );

  return { isOpen, toggle, setAll };
}
