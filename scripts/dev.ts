// Development adapter only. Production executes api/index.ts directly as a Vercel Function.
import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import handler from "../api/index.js";
import { closePool } from "../server/db.js";
const vite = await createViteServer({
  root: "frontend",
  server: { middlewareMode: true },
  configFile: false,
  plugins: [(await import("@vitejs/plugin-react")).default()],
});
const server = createServer(async (req, res) => {
  if (!(req.url || "").startsWith("/api/")) return vite.middlewares(req, res);
  try {
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
    res.end("Development adapter failed");
  }
});
const port = Number(process.env.PORT || 5173);
server.listen(port, "127.0.0.1", () =>
  console.log(`Achillea development: http://127.0.0.1:${port}`),
);
async function stop() {
  server.close();
  await vite.close();
  await closePool();
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
