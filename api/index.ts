import type { ApiRequest, ApiResponse } from "../server/http.js";
import { randomUUID } from "node:crypto";
import {
  authenticated,
  authEnabled,
  checkMutation,
  login,
  logout,
} from "../server/auth.js";
import { ApiError, input } from "../server/errors.js";
import { dispatch } from "../server/routes.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const url = new URL(req.url || "/", "http://localhost");
    for (const [name, value] of Object.entries(req.query || {})) {
      if (!url.searchParams.has(name) && typeof value === "string")
        url.searchParams.set(name, value);
    }
    // Vercel rewrites preserve the API path here via an internal query parameter.
    if (url.searchParams.has("route")) {
      const route = url.searchParams.get("route") || "";
      url.pathname = "/api/" + route;
      url.searchParams.delete("route");
    }
    const method = req.method || "GET";
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
      throw new ApiError(405, "Method not allowed");
    if (method !== "GET") checkMutation(req.headers);
    let body = req.body;
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      if (Buffer.byteLength(body) > 32768)
        throw new ApiError(413, "Request body exceeds 32 KiB");
      try {
        body = JSON.parse(body.toString());
      } catch {
        throw new ApiError(400, "Invalid JSON body");
      }
    }
    if (body !== undefined) {
      input(
        body !== null && typeof body === "object" && !Array.isArray(body),
        "JSON object body required",
      );
      if (Buffer.byteLength(JSON.stringify(body)) > 32768)
        throw new ApiError(413, "Request body exceeds 32 KiB");
    }
    const data = (body || {}) as Record<string, unknown>;
    if (url.pathname === "/api/auth/session") {
      if (!authEnabled()) {
        res.setHeader("Set-Cookie", logout());
        return res
          .status(200)
          .json({ authenticated: true, authEnabled: false });
      }
      if (method === "GET")
        return res
          .status(200)
          .json({ authenticated: authenticated(req.headers.cookie) });
      if (method === "POST") {
        res.setHeader("Set-Cookie", login(data.password));
        return res.status(200).json({ authenticated: true });
      }
      if (method === "DELETE") {
        res.setHeader("Set-Cookie", logout());
        return res.status(200).json({ authenticated: false });
      }
    }
    if (authEnabled() && (url.pathname !== "/api/health" || method !== "GET")) {
      if (!authenticated(req.headers.cookie))
        throw new ApiError(401, "Sign in with the demo access password");
    }
    return res.status(200).json(await dispatch(method, url, data));
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const status =
      error instanceof ApiError
        ? error.status
        : code?.startsWith("23")
          ? 409
          : [
                "55P03",
                "57014",
                "53300",
                "ECONNREFUSED",
                "ETIMEDOUT",
                "ENOTFOUND",
                "57P01",
              ].includes(code || "") || code?.startsWith("08")
            ? 503
            : error instanceof SyntaxError || error instanceof URIError
              ? 400
              : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : status === 409
          ? "Record conflict or evidence integrity violation"
          : status === 400
            ? "Invalid request"
            : status === 503
              ? "Database temporarily unavailable; retry shortly"
              : "Request failed";
    const correlationId = randomUUID();
    if (status >= 500)
      console.error("API request failed", {
        correlationId,
        code: /^[A-Z0-9_]{2,32}$/.test(code || "") ? code : "INTERNAL",
      });
    if (status === 503) res.setHeader("Retry-After", "1");
    return res.status(status).json({
      code: status,
      message,
      timestamp: new Date().toISOString(),
      correlationId,
    });
  }
}
