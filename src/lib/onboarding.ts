const KEY = "karrierenmin.onboarded";

export function isOnboarded(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[userId] === true;
  } catch {
    return false;
  }
}

export function markOnboarded(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[userId] = true;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}
