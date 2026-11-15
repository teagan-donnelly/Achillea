// Disposable integration-test adapter only. Application development runs through Vercel CLI.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import handler from "../api/index.js";
import { closePool } from "../server/db.js";
import { assertTestTarget } from "../scripts/test-data.js";
assertTestTarget();
const output = resolve("dist");
const server = createServer(async (req, res) => {
  try {
    if (!(req.url || "").startsWith("/api/")) {
      const pathname = decodeURIComponent(
        new URL(req.url || "/", "http://localhost").pathname,
      );
      const file = resolve(output, "." + pathname);
      if (file !== output && !file.startsWith(output + sep)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const target = extname(file) ? file : resolve(output, "index.html");
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml",
      };
      try {
        const bytes = await readFile(target);
        res.setHeader(
          "Content-Type",
          mime[extname(target)] || "application/octet-stream",
        );
        res.end(bytes);
      } catch {
        res.statusCode = 404;
        res.end();
      }
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32768) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Request body exceeds 32 KiB" }));
        return;
      }
      chunks.push(chunk);
    }
    const request = req as ApiRequest;
    request.body = bytes ? Buffer.concat(chunks).toString() : undefined;
    const response = res as ApiResponse;
    response.status = (code: number) => {
      res.statusCode = code;
      return response;
    };
    response.json = (value: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return response;
    };
    await handler(request, response);
  } catch {
    res.statusCode = 500;
    res.end("Test adapter failed");
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, "127.0.0.1", () =>
  console.log(`Disposable HTTP test adapter: http://127.0.0.1:${port}`),
);
async function stop() {
  server.close();
  await closePool();
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
