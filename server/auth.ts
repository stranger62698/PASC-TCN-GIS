import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";

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
};

const SESSION_COOKIE = "lanjifyw_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

export const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 160;
export const validUsername = (value: string) => value.trim().length >= 3 && value.trim().length <= 16;
export const validPassword = (value: string) => value.length >= 6 && value.length <= 16;

const userPath = (email: string) => `auth/users/${createHash("sha256").update(email).digest("hex")}.json`;
const passwordDigest = (password: string, salt: string) =>
  scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");

const readUser = async (email: string): Promise<StoredUser | null> => {
  const result = await get(userPath(email), { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json() as Promise<StoredUser>;
};

export async function createUser(emailInput: unknown, passwordInput: unknown, nameInput: unknown) {
  const email = normalizeEmail(emailInput);
  const password = String(passwordInput || "");
  const name = String(nameInput || "").trim();
  if (!validEmail(email)) throw new Error("请输入有效邮箱地址");
  if (!validUsername(name)) throw new Error("用户名长度需为 3–16 位");
  if (!validPassword(password)) throw new Error("密码长度需为 6–16 位");
  if (await readUser(email)) throw new Error("该邮箱已经注册，请直接登录");

  const passwordSalt = randomBytes(18).toString("base64url");
  const user: StoredUser = {
    id: randomUUID(),
    email,
    name,
    roles: [],
    passwordSalt,
    passwordHash: passwordDigest(password, passwordSalt),
    createdAt: new Date().toISOString(),
  };
  await put(userPath(email), JSON.stringify(user), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return sanitizeUser(user);
}

export async function authenticateUser(emailInput: unknown, passwordInput: unknown) {
  const email = normalizeEmail(emailInput);
  const password = String(passwordInput || "");
  if (!validEmail(email) || !validPassword(password)) return null;
  const user = await readUser(email);
  if (!user) return null;
  const expected = Buffer.from(user.passwordHash, "base64url");
  const actual = Buffer.from(passwordDigest(password, user.passwordSalt), "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return sanitizeUser(user);
}

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
