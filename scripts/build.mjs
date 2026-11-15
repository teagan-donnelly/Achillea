import { build } from "esbuild";
import { cp, mkdir, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const output = resolve(root, "dist");
export async function prepareOutput() {
  if (output !== resolve(root, "dist") || !output.startsWith(root + sep))
    throw new Error("Invalid build output path");
  const previous = await lstat(output).catch(() => null);
  if (previous?.isSymbolicLink())
    throw new Error("Refusing to replace a linked build directory");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(resolve(root, "public"), output, { recursive: true });
}
export function options(development = false) {
  return {
    absWorkingDir: root,
    entryPoints: { app: "src/index.tsx" },
    outdir: output,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: !development,
    sourcemap: development,
    metafile: true,
    entryNames: development ? "assets/[name]" : "assets/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".svg": "file",
      ".png": "file",
      ".jpg": "file",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        development ? "development" : "production",
      ),
    },
    logLevel: "info",
    plugins: [
      {
        name: "react-html",
        setup(bundler) {
          bundler.onEnd(async (result) => {
            if (result.errors.length || !result.metafile) return;
            const entry = Object.entries(result.metafile.outputs).find(
              ([, meta]) => meta.entryPoint === "src/index.tsx",
            );
            if (!entry)
              throw new Error("React entry point missing from build output");
            const url = (name) =>
              "/" + relative(output, resolve(root, name)).replaceAll("\\", "/");
            const template = await readFile(
              resolve(root, "public/index.html"),
              "utf8",
            );
            const html = template
              .replace(
                "<!-- APP_STYLES -->",
                entry[1].cssBundle
                  ? `<link rel="stylesheet" href="${url(entry[1].cssBundle)}">`
                  : "",
              )
              .replace(
                "<!-- APP_SCRIPT -->",
                `<script type="module" src="${url(entry[0])}"></script>`,
              );
            await writeFile(resolve(output, "index.html"), html);
          });
        },
      },
    ],
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await prepareOutput();
  await build(options());
}
