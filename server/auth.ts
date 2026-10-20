import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { createAuthStore, type AuthStore } from "./auth-storage.js";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
};

type StoredUser = SessionUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  lastLoginAt?: string;
  loginCount?: number;
  failedLoginAttempts?: number;
  failedLoginWindowStartedAt?: string | null;
  loginBlockedUntil?: string | null;
};

export class AuthError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); this.name = "AuthError"; }
}

const unavailable = () => new AuthError("AUTH_STORAGE_UNAVAILABLE", 503, "认证服务暂时不可用，请稍后重试");
const busy = () => new AuthError("AUTH_BUSY", 503, "认证请求繁忙，请稍后重试");
const limited = () => new AuthError("AUTH_RATE_LIMITED", 429, "登录或注册尝试次数过多，请稍后重试");
const invalid = (message: string) => new AuthError("AUTH_INVALID_INPUT", 400, message);
const duplicate = () => new AuthError("AUTH_EMAIL_EXISTS", 400, "该邮箱已经注册，请直接登录");
const ATTEMPT_PATH = "auth/security/attempts-v1.json";
const LOGIN_WINDOW_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_CAS_ATTEMPTS = 6;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

const SESSION_COOKIE = "lanjifyw_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

export const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const hasControlCharacters = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !hasControlCharacters(value) && value.length <= 160;
export const validUsername = (value: string) => value.trim().length >= 3 && value.trim().length <= 16 && !hasControlCharacters(value);
export const validPassword = (value: string) => value.length >= 6 && value.length <= 16;

const userPath = (email: string) => `auth/users/${createHash("sha256").update(email).digest("hex")}.json`;
const passwordDigest = (password: string, salt: string) =>
  scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");

type AttemptCounter = { schemaVersion: "auth-attempts-v1"; loginWindow: number; loginAttempts: number; registrationWindow: number; registrations: number };

export function createAuthService(options: { store: AuthStore; now?: () => number }) {
  const { store, now = Date.now } = options;
  const read = async (path: string) => {
    try {
      const result = await store.read(path);
      if (result !== null && (!result.etag || !object(result.value))) throw unavailable();
      return result;
    } catch { throw unavailable(); }
  };
  const write = async (path: string, etag: string | null, value: unknown) => {
    try {
      const result = await store.compareAndSwap(path, etag, value);
      if (result !== true && result !== false) throw unavailable();
      return result;
    } catch { throw unavailable(); }
  };
  const clock = () => {
    const timestamp = now();
    if (!count(timestamp) || timestamp > 8_640_000_000_000_000) throw unavailable();
    return timestamp;
  };
  const userRecord = (value: unknown, email: string): StoredUser => {
    if (!object(value) || typeof value.id !== "string" || !value.id || value.id.length > 80 || value.email !== email
      || typeof value.name !== "string" || !validUsername(value.name) || !Array.isArray(value.roles) || !value.roles.every(role => typeof role === "string")
      || typeof value.passwordHash !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value.passwordHash)
      || typeof value.passwordSalt !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(value.passwordSalt) || !date(value.createdAt)) throw unavailable();
    for (const key of ["loginCount", "failedLoginAttempts"] as const) if (value[key] !== undefined && !count(value[key])) throw unavailable();
    for (const key of ["lastLoginAt", "failedLoginWindowStartedAt", "loginBlockedUntil"] as const) if (value[key] !== undefined && value[key] !== null && !date(value[key])) throw unavailable();
    return structuredClone(value) as StoredUser;
  };
  // Fixed-size, shared counters: no IP, user agent, per-request object or log.
  // Session checks never reach this code. Account failures have a much tighter
  // independent limit; these broad ceilings bound registration/storage abuse.
  const consumeAttempt = async (kind: "login" | "register") => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const stored = await read(ATTEMPT_PATH), timestamp = clock();
      const loginWindow = Math.floor(timestamp / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
      const registrationWindow = Math.floor(timestamp / DAY_MS) * DAY_MS;
      const value: AttemptCounter = stored === null
        ? { schemaVersion: "auth-attempts-v1", loginWindow, loginAttempts: 0, registrationWindow, registrations: 0 }
        : structuredClone(stored.value) as AttemptCounter;
      if (value.schemaVersion !== "auth-attempts-v1" || !count(value.loginWindow) || !count(value.registrationWindow)
        || !count(value.loginAttempts) || !count(value.registrations) || value.loginWindow > loginWindow || value.registrationWindow > registrationWindow) throw unavailable();
      if (value.loginWindow !== loginWindow) { value.loginWindow = loginWindow; value.loginAttempts = 0; }
      if (value.registrationWindow !== registrationWindow) { value.registrationWindow = registrationWindow; value.registrations = 0; }
      if (kind === "login") { if (value.loginAttempts >= 1_000) throw limited(); value.loginAttempts += 1; }
      else { if (value.registrations >= 100) throw limited(); value.registrations += 1; }
      if (await write(ATTEMPT_PATH, stored?.etag ?? null, value)) return;
    }
    throw busy();
  };
  const createUser = async (emailInput: unknown, passwordInput: unknown, nameInput: unknown) => {
    const email = normalizeEmail(emailInput), password = typeof passwordInput === "string" ? passwordInput : "", name = typeof nameInput === "string" ? nameInput.trim() : "";
    if (!validEmail(email)) throw invalid("请输入有效邮箱地址");
    if (!validUsername(name)) throw invalid("用户名长度需为 3–16 位");
    if (!validPassword(password)) throw invalid("密码长度需为 6–16 位");
    await consumeAttempt("register");
    if (await read(userPath(email))) throw duplicate();
    const passwordSalt = randomBytes(18).toString("base64url"), timestamp = new Date(clock()).toISOString();
    const user: StoredUser = { id: randomUUID(), email, name, roles: [], passwordSalt, passwordHash: passwordDigest(password, passwordSalt), createdAt: timestamp, lastLoginAt: timestamp, loginCount: 1, failedLoginAttempts: 0, failedLoginWindowStartedAt: null, loginBlockedUntil: null };
    if (!await write(userPath(email), null, user)) throw duplicate();
    return sanitizeUser(user);
  };
  const authenticateUser = async (emailInput: unknown, passwordInput: unknown) => {
    const email = normalizeEmail(emailInput), password = typeof passwordInput === "string" ? passwordInput : "";
    if (!validEmail(email) || !validPassword(password)) return null;
    await consumeAttempt("login");
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const stored = await read(userPath(email));
      if (!stored) return null;
      const user = userRecord(stored.value, email), timestamp = clock();
      if (Date.parse(user.createdAt) > timestamp || (user.lastLoginAt && Date.parse(user.lastLoginAt) > timestamp)
        || (user.failedLoginWindowStartedAt && Date.parse(user.failedLoginWindowStartedAt) > timestamp)) throw unavailable();
      if (user.loginBlockedUntil && Date.parse(user.loginBlockedUntil) > timestamp) throw limited();
      const windowStart = user.failedLoginWindowStartedAt ? Date.parse(user.failedLoginWindowStartedAt) : null;
      const failures = windowStart !== null && timestamp - windowStart < LOGIN_WINDOW_MS ? user.failedLoginAttempts ?? 0 : 0;
      const expected = Buffer.from(user.passwordHash, "base64url"), actual = Buffer.from(passwordDigest(password, user.passwordSalt), "base64url");
      const accepted = expected.length === actual.length && timingSafeEqual(expected, actual);
      if (accepted) {
        if ((user.loginCount ?? 0) >= Number.MAX_SAFE_INTEGER) throw unavailable();
        user.lastLoginAt = new Date(timestamp).toISOString(); user.loginCount = (user.loginCount ?? 0) + 1;
        user.failedLoginAttempts = 0; user.failedLoginWindowStartedAt = null; user.loginBlockedUntil = null;
      } else {
        user.failedLoginAttempts = failures + 1;
        user.failedLoginWindowStartedAt = new Date(failures > 0 && windowStart !== null ? windowStart : timestamp).toISOString();
        user.loginBlockedUntil = user.failedLoginAttempts >= 5 ? new Date(timestamp + LOGIN_WINDOW_MS).toISOString() : null;
      }
      if (await write(userPath(email), stored.etag, user)) return accepted ? sanitizeUser(user) : null;
    }
    throw busy();
  };
  return { createUser, authenticateUser };
}

const authService = createAuthService({ store: createAuthStore() });
export const createUser = authService.createUser;
export const authenticateUser = authService.authenticateUser;

const sanitizeUser = (user: StoredUser): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  roles: Array.isArray(user.roles) ? user.roles : [],
});

const authSecret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET 未配置");
  return value;
};

export function createSessionToken(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", authSecret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionUser & { exp: number };
    if (!value.id || !value.email || !value.exp || value.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: value.id, email: value.email, name: value.name, roles: Array.isArray(value.roles) ? value.roles : [] };
  } catch {
    return null;
  }
}

export function parseCookies(header?: string) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [decodeURIComponent(key), decodeURIComponent(rest.join("="))]),
  );
}

export const getRequestUser = (cookieHeader?: string) => readSessionToken(parseCookies(cookieHeader)[SESSION_COOKIE]);

export const sessionCookie = (token: string, secure = true) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${SESSION_SECONDS}`;

export const clearSessionCookie = (secure = true) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`;
