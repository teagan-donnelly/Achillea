import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import handler from "./api/index.js";
import { closePool } from "./server/db.js";
import type { ApiRequest, ApiResponse } from "./server/http.js";

// Keep the existing /api contract available under the ordinary Vite dev command.
function localApi(): Plugin {
  const configure = (server: Pick<ViteDevServer, "httpServer" | "middlewares">) => {
    server.httpServer?.once("close", () => { void closePool(); });
    server.middlewares.use(async (req, res, next) => {
      if (!(req.url || "").startsWith("/api/")) return next();
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) {
            res.statusCode = 413;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ message: "Request body exceeds 32 KiB" }));
            return;
          }
          chunks.push(chunk);
        }
        const request = req as ApiRequest;
        request.body = size ? Buffer.concat(chunks).toString() : undefined;
        const response = res as ApiResponse;
        response.status = (code) => { res.statusCode = code; return response; };
        response.json = (value) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
          return response;
        };
        await handler(request, response);
      } catch {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Local API request failed" }));
      }
    });
  };
  return { name: "achillea-local-api", configureServer: configure, configurePreviewServer: configure };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [name, value] of Object.entries(env)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  // Server credentials stay in this Node process; only Vite's default VITE_* prefix is public.
  return { plugins: [react(), localApi()] };
});
