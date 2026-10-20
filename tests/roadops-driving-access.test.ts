import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRoadOpsDrivingRequest, type RoadOpsDrivingAccessInput, type RoadOpsDrivingAccessResult } from "../server/roadops-driving-access.js";

const sameOrigin: RoadOpsDrivingAccessInput = {
  method: "POST",
  origin: "https://roadops.example",
  requestOrigin: "https://roadops.example",
};

const denied = (result: RoadOpsDrivingAccessResult) => {
  assert.ok(!("identity" in result));
  assert.equal(result.headers["cache-control"], "private, no-store");
  const body = result.body as { error: { code: string; message: string; retryable: boolean; fallbackAvailable: boolean } };
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.fallbackAvailable, false);
  return { ...result, body };
};

test("production access rejects methods before origin and session validation", async () => {
  let called = false;
  const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, method: "GET", origin: "" }, () => {
    called = true;
    throw new Error("session resolution must not run");
  }));
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, "POST");
  assert.equal(called, false);
});

test("production access requires a complete same HTTPS origin before reading sessions", async () => {
  for (const origin of ["", "null", "roadops.example", "https:roadops.example", "https:/roadops.example", "https:///roadops.example", "http://roadops.example", "https://evil.example", "https://roadops.example:444", "https://roadops.example/path", "https://roadops.example/..", "https://roadops.example?x=1", "https://roadops.example#fragment", "https://user@roadops.example", " https://roadops.example", "https:\\roadops.example"]) {
    let called = false;
    const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, origin }, () => {
      called = true;
      return { id: "signed-user" };
    }));
    assert.equal(result.status, 403, origin);
    assert.equal(result.body.error.code, "ROADOPS_DIDI_ORIGIN");
    assert.equal(called, false, origin);
  }
});

test("production access does not accept an insecure or malformed expected origin", async () => {
  for (const requestOrigin of ["", "http://roadops.example", "https://roadops.example/path", "https://roadops.example,evil.example"]) {
    const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, requestOrigin }, () => ({ id: "signed-user" })));
    assert.equal(result.status, 403);
  }
});

test("production access rejects missing and unsigned cookies without minting a session", async () => {
  for (const cookieHeader of [undefined, "", "lanjifyw_session=fake-session", "unrelated=user-123", "identity=user:forged; forwarded=203.0.113.7"]) {
    const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, cookieHeader }));
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, "ROADOPS_DIDI_LOGIN_REQUIRED");
    assert.match(result.body.error.message, /请登录后规划/);
  }
});

test("production access passes the complete cookie only to the signed session resolver", async () => {
  const cookieHeader = "other=ignored; lanjifyw_session=unsigned.payload; user=forged";
  let resolvedCookie: string | undefined;
  const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, cookieHeader }, cookie => {
    resolvedCookie = cookie;
    return null;
  }));
  assert.equal(result.status, 401);
  assert.equal(resolvedCookie, cookieHeader);
});

test("malformed cookie decoding fails closed without contacting any provider", async () => {
  const result = denied(await authorizeRoadOpsDrivingRequest({ ...sameOrigin, cookieHeader: "lanjifyw_session=%" }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "ROADOPS_DIDI_AUTH_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /URI malformed/);
});

test("authenticated same-origin access uses the signed id and ignores forged IP and identity values", async () => {
  const cookieHeader = "lanjifyw_session=resolver-test-session";
  const forged = {
    ...sameOrigin,
    cookieHeader,
    identity: "user:forged",
    forwardedFor: "203.0.113.7",
    connectingIp: "203.0.113.8",
    forwardedHost: "evil.example",
  };
  const result = await authorizeRoadOpsDrivingRequest(forged, cookie => {
    assert.equal(cookie, cookieHeader);
    return { id: "signed-user-123" };
  });
  assert.deepEqual(result, { identity: "user:signed-user-123" });
});

test("HTTPS origin matching compares parsed scheme and host including normalized ports", async () => {
  const result = await authorizeRoadOpsDrivingRequest({ ...sameOrigin, origin: "https://ROADOPS.example:443" }, async () => ({ id: "signed-user" }));
  assert.deepEqual(result, { identity: "user:signed-user" });
});

test("production access rejects a resolver result without a valid signed user id", async () => {
  for (const id of ["", " "]) {
    const result = denied(await authorizeRoadOpsDrivingRequest(sameOrigin, () => ({ id })));
    assert.equal(result.status, 401);
  }
});

test("session resolver failures fail closed without exposing their exception", async () => {
  const result = denied(await authorizeRoadOpsDrivingRequest(sameOrigin, async () => {
    throw new Error("PRIVATE_SESSION_BACKEND_VALUE");
  }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "ROADOPS_DIDI_AUTH_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SESSION_BACKEND_VALUE/);
  assert.equal("identity" in result, false);
});
