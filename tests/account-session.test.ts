import assert from "node:assert/strict";
import test from "node:test";
import { createAccountSessionStore } from "../app/lib/account-session-store";
import { publicWorkspaceAccess } from "../app/lib/data-processing-policy";
import type { AuthUser } from "../app/lib/auth-client";

const user: AuthUser = { id: "test-account", name: "Test user", email: "test@example.invalid", roles: [] };
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("simultaneous gates share one server session request and reuse only a short cache", async () => {
  let calls = 0, now = 0;
  const pending = deferred<AuthUser | null>();
  const store = createAccountSessionStore(() => { calls += 1; return pending.promise; }, () => now);
  const first = store.refresh(), second = store.refresh();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  assert.equal(store.getSnapshot().status, "checking");
  pending.resolve(user); await first;
  assert.equal(store.getSnapshot().user, user);
  await store.refresh(); assert.equal(calls, 1);
  now = 15_001; await store.refresh(); assert.equal(calls, 2);
});

test("fresh action checks observe expiry and fail closed on a service error", async () => {
  let load = async (): Promise<AuthUser | null> => user;
  const store = createAccountSessionStore(() => load());
  await store.refresh(); assert.equal(store.getSnapshot().status, "authenticated");
  load = async () => null; await store.refresh(true);
  assert.equal(store.getSnapshot().status, "anonymous"); assert.equal(store.getSnapshot().user, null);
  load = async () => { throw new Error("Authentication unavailable"); }; await store.refresh(true);
  assert.equal(store.getSnapshot().status, "error"); assert.equal(store.getSnapshot().user, null);
  assert.equal(store.getSnapshot().error, "Authentication unavailable");
  load = async () => user; await store.refresh(true);
  assert.equal(store.getSnapshot().status, "authenticated");
});

test("logout cannot be undone by an older pending session response", async () => {
  const pending = deferred<AuthUser | null>();
  const store = createAccountSessionStore(() => pending.promise);
  const request = store.refresh(); store.clear(); pending.resolve(user); await request;
  assert.equal(store.getSnapshot().status, "anonymous"); assert.equal(store.getSnapshot().user, null);
});

test("cross-tab invalidation requires a new server response and ignores an older identity", async () => {
  const old = deferred<AuthUser | null>(), next = deferred<AuthUser | null>(); let count = 0;
  const store = createAccountSessionStore(() => ++count === 1 ? old.promise : next.promise);
  const first = store.refresh(); await Promise.resolve();
  store.invalidate(); const second = store.refresh(true); await Promise.resolve();
  old.resolve(user); await first; assert.equal(store.getSnapshot().status, "checking");
  next.resolve({ ...user, id: "other-account" }); await second;
  assert.equal(store.getSnapshot().user?.id, "other-account");
});

test("only explicit example browsing bypasses the personal workspace gate", () => {
  for (const demo of ["haikou", "landslide", "road"]) assert.equal(publicWorkspaceAccess(new URLSearchParams({ demo })), true);
  for (const query of ["", "source=local", "intent=upload", "demo=unknown", "demo=road&source=local", "demo=road&scope=full", "demo=road&dataset=id", "demo=haikou&job=id", "demo=haikou&largeJob=id", "demo=road&restore=analysis", "demo=road&intent=upload"]) assert.equal(publicWorkspaceAccess(new URLSearchParams(query)), false, query);
  assert.equal(publicWorkspaceAccess(new URLSearchParams("demo=road"), true), false);
});
