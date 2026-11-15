// Vercel CLI owns the public port and API functions. This child only serves React assets.
import { context } from "esbuild";
import { options, output, prepareOutput } from "./build.mjs";
await prepareOutput();
const bundler = await context(options(true));
await bundler.watch();
const { port } = await bundler.serve({
  host: "127.0.0.1",
  port: Number(process.env.PORT || 3001),
  servedir: output,
  fallback: output + "/index.html",
});
console.log(
  `React assets ready on http://127.0.0.1:${port}; Vercel serves the application and API.`,
);
async function stop() {
  await bundler.dispose();
  process.exit(0);
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
