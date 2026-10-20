import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import test from "node:test";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { AuthError, createAuthService } from "../server/auth.js";
import { createAuthStore, type AuthStore } from "../server/auth-storage.js";

const EMAIL = "fixture@example.invalid";
const PASSWORD = "fixture-pass";
const COUNTER = "auth/security/attempts-v1.json";
const userPath = (email = EMAIL) => `auth/users/${createHash("sha256").update(email).digest("hex")}.json`;
const start = Date.UTC(2026, 9, 17, 1);
const isAuthError = (status: number, code?: string) => (error: unknown) => error instanceof AuthError && error.status === status && (!code || error.code === code);
class MemoryStore implements AuthStore {
  values = new Map<string, { value: unknown; etag: string }>();
  reads = 0;
  writes: Array<{ path: string; etag: string | null; value: unknown }> = [];
  revision = 0;
  failRead = false;
  failWritePath: string | null = null;
  failAfterWrite = false;
  async read(path: string) {
    this.reads += 1;
    if (this.failRead) throw new Error("private credential detail");
    return structuredClone(this.values.get(path) ?? null);
  }
  async compareAndSwap(path: string, etag: string | null, value: unknown) {
    this.writes.push({ path, etag, value: structuredClone(value) });
    if (path === this.failWritePath && !this.failAfterWrite) throw new Error("private write detail");
    if ((this.values.get(path)?.etag ?? null) !== etag) return false;
    this.values.set(path, { etag: String(++this.revision), value: structuredClone(value) });
    if (path === this.failWritePath && this.failAfterWrite) throw new Error("private response lost");
    return true;
  }
  seed(path: string, value: unknown) { this.values.set(path, { etag: String(++this.revision), value: structuredClone(value) }); }
  user() { return this.values.get(userPath())!.value as Record<string, unknown>; }
}
function setup() {
  const store = new MemoryStore();
  let timestamp = start;
  const service = () => createAuthService({ store, now: () => timestamp });
  return { store, service, advance: (ms: number) => { timestamp += ms; } };
}
function legacyUser() {
  const salt = "a".repeat(24);
  return { id: "legacy-fixture-account", email: EMAIL, name: "Fixture user", roles: ["operator"], passwordSalt: salt, passwordHash: scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url"), createdAt: new Date(start - 86_400_000).toISOString() };
}

test("registration records only bounded account metadata and auto-login audit, never a password or CSV", async () => {
  const { store, service } = setup();
  const user = await service().createUser(`  ${EMAIL.toUpperCase()} `, PASSWORD, " Fixture user ");
  assert.deepEqual(Object.keys(user).sort(), ["email", "id", "name", "roles"]);
  const record = store.user();
  assert.equal(record.email, EMAIL);
  assert.equal(record.lastLoginAt, record.createdAt);
  assert.equal(record.loginCount, 1);
  assert.equal(record.failedLoginAttempts, 0);
  assert.notEqual(record.passwordHash, PASSWORD);
  assert.doesNotMatch(JSON.stringify(record), /fixture-pass|csv|userAgent|ipAddress/i);
  assert.deepEqual([...store.values.keys()].sort(), [COUNTER, userPath()].sort());
});

test("legacy accounts retain identity, credentials, roles and registration date when first adding login audit", async () => {
  const { store, service } = setup(), original = legacyUser();
  store.seed(userPath(), original);
  const user = await service().authenticateUser(EMAIL, PASSWORD);
  assert.equal(user?.id, original.id);
  assert.deepEqual(user?.roles, original.roles);
  for (const key of Object.keys(original)) assert.deepEqual(store.user()[key], original[key as keyof typeof original]);
  assert.equal(store.user().lastLoginAt, new Date(start).toISOString());
  assert.equal(store.user().loginCount, 1);
  assert.doesNotMatch(JSON.stringify(user), /passwordHash|passwordSalt|failedLogin/);
});

test("concurrent same-email registrations create one identity and never replace the winning account", async () => {
  const { store, service } = setup();
  const results = await Promise.allSettled([service().createUser(EMAIL, "first-pass", "First user"), service().createUser(EMAIL, "second-pass", "Second user")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const winner = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<{ id: string; name: string }>;
  assert.equal(store.user().id, winner.value.id);
  assert.equal(store.user().name, winner.value.name);
  assert.equal(store.user().loginCount, 1);
  assert.equal(store.values.size, 2);
  const loser = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(isAuthError(400, "AUTH_EMAIL_EXISTS")(loser.reason));
  assert.ok(store.writes.filter(write => write.path === userPath()).every(write => write.etag === null));
});

test("concurrent successful logins from separate service instances preserve both audit increments", async () => {
  const { store, service } = setup();
  await service().createUser(EMAIL, PASSWORD, "Fixture user");
  const results = await Promise.all([service().authenticateUser(EMAIL, PASSWORD), service().authenticateUser(EMAIL, PASSWORD)]);
  assert.ok(results.every(user => user?.id === store.user().id));
  assert.equal(store.user().loginCount, 3);
  assert.equal((store.values.get(COUNTER)!.value as { loginAttempts: number }).loginAttempts, 2);
});

test("five failures lock that account across instances, expire after fifteen minutes and reset on success", async () => {
  const { store, service, advance } = setup();
  await service().createUser(EMAIL, PASSWORD, "Fixture user");
  await service().createUser("other@example.invalid", PASSWORD, "Other user");
  for (let index = 0; index < 5; index += 1) assert.equal(await service().authenticateUser(EMAIL, "wrong-pass"), null);
  assert.equal(store.user().failedLoginAttempts, 5);
  assert.equal(store.user().loginCount, 1);
  await assert.rejects(() => service().authenticateUser(EMAIL, PASSWORD), isAuthError(429));
  assert.ok(await service().authenticateUser("other@example.invalid", PASSWORD));
  advance(15 * 60_000 + 1);
  assert.ok(await service().authenticateUser(EMAIL, PASSWORD));
  assert.equal(store.user().loginCount, 2);
  assert.equal(store.user().failedLoginAttempts, 0);
  assert.equal(store.user().loginBlockedUntil, null);
});

test("concurrent failed logins cannot lose account failure counts", async () => {
  const { store, service } = setup();
  await service().createUser(EMAIL, PASSWORD, "Fixture user");
  assert.deepEqual(await Promise.all([service().authenticateUser(EMAIL, "wrong-pass"), service().authenticateUser(EMAIL, "wrong-pass")]), [null, null]);
  assert.equal(store.user().failedLoginAttempts, 2);
  assert.equal(store.user().loginCount, 1);
});

test("shared broad ceilings reject before account work and keep a single fixed counter without unknown-email objects", async () => {
  const { store, service, advance } = setup();
  const counter = { schemaVersion: "auth-attempts-v1", loginWindow: Math.floor(start / 900_000) * 900_000, loginAttempts: 999, registrationWindow: Math.floor(start / 86_400_000) * 86_400_000, registrations: 100 };
  store.seed(COUNTER, counter);
  await assert.rejects(() => service().createUser(EMAIL, PASSWORD, "Fixture user"), isAuthError(429));
  assert.equal(await service().authenticateUser("missing@example.invalid", PASSWORD), null);
  await assert.rejects(() => service().authenticateUser("another@example.invalid", PASSWORD), isAuthError(429));
  assert.equal(store.values.size, 1);
  advance(900_000);
  assert.equal(await service().authenticateUser("missing@example.invalid", PASSWORD), null);
  assert.equal(store.values.size, 1);
});

test("invalid field types are rejected before any storage, hashing or implicit object coercion", async () => {
  const { store, service } = setup();
  await assert.rejects(() => service().createUser({ toString: () => EMAIL }, PASSWORD, "Fixture user"), isAuthError(400));
  await assert.rejects(() => service().createUser(EMAIL, { password: PASSWORD }, "Fixture user"), isAuthError(400));
  await assert.rejects(() => service().createUser(`bad${String.fromCharCode(0)}@example.invalid`, PASSWORD, "Fixture user"), isAuthError(400));
  assert.equal(await service().authenticateUser(EMAIL, { toString: () => PASSWORD }), null);
  assert.equal(store.reads, 0);
  assert.equal(store.writes.length, 0);
});

test("unknown storage failures and corrupt account records fail closed without leaking or replacing credentials", async () => {
  const { store, service } = setup();
  store.failRead = true;
  await assert.rejects(() => service().createUser(EMAIL, PASSWORD, "Fixture user"), error => isAuthError(503)(error) && !String(error).includes("credential detail"));
  store.failRead = false;
  const original = { ...legacyUser(), passwordHash: "corrupt" };
  store.seed(userPath(), original);
  await assert.rejects(() => service().authenticateUser(EMAIL, PASSWORD), isAuthError(503));
  assert.deepEqual(store.user(), original);
});

test("an uncertain audit write cannot authenticate or retry an already committed login", async () => {
  const { store, service } = setup();
  store.seed(userPath(), legacyUser());
  store.failWritePath = userPath(); store.failAfterWrite = true;
  await assert.rejects(() => service().authenticateUser(EMAIL, PASSWORD), isAuthError(503));
  assert.equal(store.user().loginCount, 1);
  assert.equal(store.writes.filter(write => write.path === userPath()).length, 1);
});

test("authentication never rewrites existing driving quota, datasets or job records", async () => {
  const { store, service } = setup();
  const protectedPaths = ["roadops/quota/driving-v1.json", "users/fixture/datasets/fixture/chunks/0", "users/fixture/pasc-jobs/fixture/meta.json"];
  for (const path of protectedPaths) store.seed(path, { fixtureMetadata: true });
  const originals = protectedPaths.map(path => structuredClone(store.values.get(path)));
  await service().createUser(EMAIL, PASSWORD, "Fixture user");
  assert.equal(await service().authenticateUser(EMAIL, "wrong-pass"), null);
  assert.ok(await service().authenticateUser(EMAIL, PASSWORD));
  assert.deepEqual(protectedPaths.map(path => store.values.get(path)), originals);
  assert.ok(store.writes.every(write => write.path.startsWith("auth/")));
});

test("production adapter uses non-overwriting creation and exact ETag updates; only definite conflicts retry", async () => {
  const calls: Array<Parameters<typeof put>> = [];
  let failure: Error | null = null;
  const io = { get: (async () => null) as typeof get, put: (async (...args: Parameters<typeof put>) => { calls.push(args); if (failure) throw failure; return {}; }) as typeof put };
  const store = createAuthStore(io);
  assert.equal(await store.compareAndSwap("auth/fixture", null, { fixture: true }), true);
  assert.equal(calls[0][2]?.allowOverwrite, false);
  assert.equal(calls[0][2]?.ifMatch, undefined);
  assert.equal(await store.compareAndSwap("auth/fixture", "revision-1", { fixture: true }), true);
  assert.equal(calls[1][2]?.allowOverwrite, true);
  assert.equal(calls[1][2]?.ifMatch, "revision-1");
  failure = new BlobPreconditionFailedError();
  assert.equal(await store.compareAndSwap("auth/fixture", "revision-1", {}), false);
  failure = new Error("unknown write outcome");
  await assert.rejects(() => store.compareAndSwap("auth/fixture", "revision-1", {}), /unknown write outcome/);
});
