import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
const publicUrl = process.env.DEMO_PUBLIC_URL
  ? new URL(process.env.DEMO_PUBLIC_URL)
  : undefined;
if (publicUrl && (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password))
  throw new Error("DEMO_PUBLIC_URL must be an HTTPS URL without credentials");
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: publicUrl ? [publicUrl.hostname] : [],
    hmr: publicUrl
      ? { protocol: "wss", host: publicUrl.hostname, clientPort: 443 }
      : undefined,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
      },
    },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
