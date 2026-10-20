import type { AuthUser } from "./auth-client";

export type AccountSession = {
  status: "checking" | "authenticated" | "anonymous" | "error";
  user: AuthUser | null;
  error: string;
};
export const INITIAL_ACCOUNT_SESSION: AccountSession = { status: "checking", user: null, error: "" };

/** Only account identity is shared; no file, dataset or analysis is transmitted or persisted. */
export function createAccountSessionStore(load: () => Promise<AuthUser | null>, now = Date.now) {
  let state = INITIAL_ACCOUNT_SESSION;
  let pending: Promise<void> | null = null;
  let generation = 0;
  let checkedAt = -Infinity;
  const listeners = new Set<() => void>();
  const publish = (next: AccountSession) => { state = next; listeners.forEach(listener => listener()); };
  const refresh = (force = false): Promise<void> => {
    if (pending) return pending;
    if (!force && now() - checkedAt < 15_000) return Promise.resolve();
    const current = generation;
    const request = Promise.resolve().then(load).then(user => {
      if (current !== generation) return;
      checkedAt = now();
      publish({ status: user ? "authenticated" : "anonymous", user, error: "" });
    }, error => {
      if (current !== generation) return;
      checkedAt = now();
      publish({ status: "error", user: null, error: error instanceof Error ? error.message : "认证服务暂时不可用，请重试。" });
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    invalidate() {
      generation += 1; pending = null; checkedAt = -Infinity;
      publish(INITIAL_ACCOUNT_SESSION);
    },
    clear() {
      generation += 1; pending = null; checkedAt = now();
      publish({ status: "anonymous", user: null, error: "" });
    },
  };
}
