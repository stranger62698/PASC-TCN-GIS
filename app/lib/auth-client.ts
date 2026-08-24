export type AuthUser = { id: string; email: string; name: string; roles: string[] };

const decode = async (response: Response) => {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error("认证服务未连接，请刷新页面后重试");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "认证操作失败");
  return body;
};

export async function authRequest(op: "login" | "register" | "forgot", input: Record<string, string>) {
  return decode(await fetch(`/api/auth?op=${op}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function getSession(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth?op=session", { credentials: "include", cache: "no-store" });
  const body = await decode(response);
  return body.authenticated ? body.user : null;
}

export async function signOut() {
  await decode(await fetch("/api/auth?op=logout", { method: "POST", credentials: "include" }));
}
