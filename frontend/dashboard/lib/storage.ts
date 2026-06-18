export type StoredKeys = {
  aimlApiKey?: string;
  featherlessApiKey?: string;
  humanReviewerApiKey?: string;
  aimlModel?: string;
  featherlessModel?: string;
  updatedAt: string;
};

export type SessionRecord = {
  chatId: string;
  label: string;
  startedAt: string;
  phase: string;
  lastSyncedAt: string;
  /** Human Reviewer's signed decision, when the gateway reports one
   *  (null until signed, undefined when not yet synced from claims). */
  decision?: "approve" | "deny" | null;
};

const KEYS_STORAGE = "arbiter:keys";
const SESSIONS_STORAGE = "arbiter:sessions";
export const SESSIONS_CHANGED_EVENT = "arbiter:sessions-changed";
const EMPTY_SESSIONS: SessionRecord[] = [];

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getStoredKeys(): StoredKeys | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    if (!raw) return null;
    return JSON.parse(raw) as StoredKeys;
  } catch {
    return null;
  }
}

export function saveStoredKeys(keys: Omit<StoredKeys, "updatedAt">): StoredKeys {
  const payload: StoredKeys = { ...keys, updatedAt: new Date().toISOString() };
  if (isBrowser()) {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(payload));
  }
  return payload;
}

export function clearStoredKeys(): void {
  if (isBrowser()) localStorage.removeItem(KEYS_STORAGE);
}

export function getSessions(): SessionRecord[] {
  if (!isBrowser()) return EMPTY_SESSIONS;
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE);
    if (!raw) return EMPTY_SESSIONS;
    return JSON.parse(raw) as SessionRecord[];
  } catch {
    return EMPTY_SESSIONS;
  }
}

export function saveSessions(sessions: SessionRecord[]): void {
  if (isBrowser()) {
    localStorage.setItem(SESSIONS_STORAGE, JSON.stringify(sessions));
    window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
  }
}

export type KeysStatus = "none" | "partial" | "configured";

export function keysStatus(): KeysStatus {
  const k = getStoredKeys();
  if (!k) return "none";
  const count = [k.aimlApiKey, k.featherlessApiKey, k.humanReviewerApiKey].filter(Boolean).length;
  if (count === 0) return "none";
  if (count === 3) return "configured";
  return "partial";
}
