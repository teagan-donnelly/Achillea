import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";
const cookieName = "achillea_session";
const lifetime = 8 * 60 * 60;
// Temporarily opt-in: no password or session secret is required while disabled.
export function authEnabled() {
  return process.env.APP_AUTH_ENABLED === "true";
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function config() {
  const password = process.env.APP_ACCESS_PASSWORD || "",
    secret = process.env.APP_SESSION_SECRET || "";
  if (password.length < 24 || secret.length < 32 || equal(password, secret))
    throw new ApiError(
      503,
      "Configure distinct APP_ACCESS_PASSWORD (24+) and APP_SESSION_SECRET (32+) server secrets",
    );
  return { password, secret };
}
function sign(payload: string) {
  return createHmac("sha256", config().secret)
    .update(payload)
    .digest("base64url");
}
export function authenticated(cookie = "") {
  config();
  const token = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !equal(parts[1], sign(parts[0]))) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return (
      data.nurse === "nurse-demo" &&
      Number.isInteger(data.exp) &&
      data.exp > Date.now() / 1000 &&
      data.exp <= Date.now() / 1000 + lifetime + 60
    );
  } catch {
    return false;
  }
}
export function login(password: unknown) {
  if (typeof password !== "string" || !equal(password, config().password))
    throw new ApiError(401, "Invalid demo password");
  const payload = Buffer.from(
    JSON.stringify({
      nurse: "nurse-demo",
      exp: Math.floor(Date.now() / 1000) + lifetime,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${cookieName}=${payload}.${sign(payload)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${lifetime}${process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function logout() {
  return `${cookieName}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function checkMutation(
  headers: Record<string, string | string[] | undefined>,
) {
  if (headers["x-achillea-request"] !== "1")
    throw new ApiError(403, "Same-origin application request required");
  const origin = headers.origin;
  const expected = process.env.APP_ORIGIN;
  if (expected && origin && origin !== expected)
    throw new ApiError(403, "Origin is not allowed");
  // Browsers add Origin on cross-origin JSON requests. No CORS response grants access.
  const host = headers["x-forwarded-host"] || headers.host;
  if (
    origin &&
    !expected &&
    (typeof origin !== "string" || new URL(origin).host !== host)
  )
    throw new ApiError(403, "Origin is not allowed");
}
