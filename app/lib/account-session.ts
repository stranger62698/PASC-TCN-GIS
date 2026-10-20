"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AUTH_CHANGED_EVENT, AUTH_REVISION_KEY, getSession, signOut } from "./auth-client";
import { createAccountSessionStore, INITIAL_ACCOUNT_SESSION } from "./account-session-store";

const store = createAccountSessionStore(getSession);
export const PERSONAL_DATA_ACCESS_EVENT = "lanjifyw:personal-data-access";
let subscribers = 0;
let stopListening: (() => void) | undefined;
function subscribe(listener: () => void) {
  const unsubscribe = store.subscribe(listener);
  subscribers += 1;
  if (subscribers === 1 && typeof window !== "undefined") {
    const focus = () => { if (document.visibilityState !== "hidden") void store.refresh(); };
    const changed = () => { store.invalidate(); void store.refresh(true); };
    const storage = (event: StorageEvent) => { if (event.key === AUTH_REVISION_KEY) changed(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener(AUTH_CHANGED_EVENT, changed);
    window.addEventListener("storage", storage);
    const timer = window.setInterval(focus, 5 * 60_000);
    stopListening = () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener(AUTH_CHANGED_EVENT, changed);
      window.removeEventListener("storage", storage);
      window.clearInterval(timer);
    };
  }
  return () => { unsubscribe(); subscribers -= 1; if (!subscribers) { stopListening?.(); stopListening = undefined; } };
}
const refresh = () => store.refresh(true);
const logout = async () => { await signOut(); store.clear(); };
export async function requireAccountSession() {
  await store.refresh(true);
  const state = store.getSnapshot();
  const user = state.status === "authenticated" ? state.user : null;
  // A public example becomes a personal workspace before accepting a user file.
  // This event can only restrict access; it never grants an authenticated state.
  if (user && typeof window !== "undefined") window.dispatchEvent(new Event(PERSONAL_DATA_ACCESS_EVENT));
  return user;
}

export function useAccountSession() {
  const state = useSyncExternalStore(subscribe, store.getSnapshot, () => INITIAL_ACCOUNT_SESSION);
  useEffect(() => { void store.refresh(); }, []);
  return { ...state, refresh, logout };
}
