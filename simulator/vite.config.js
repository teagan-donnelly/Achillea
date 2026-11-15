// Serves the simulator and proxies /api to the Achillea backend, so the browser only calls same-origin /api/...
// (the backend sends no CORS headers). Set ACHILLEA_API in the shell or in .env.local to point elsewhere.
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = process.env.ACHILLEA_API ?? env.ACHILLEA_API ?? "http://127.0.0.1:18184";
  return {
    server: { proxy: { "/api": { target, changeOrigin: true } } },
  };
});
