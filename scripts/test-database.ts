import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { randomUUID } from "node:crypto";

let bin = process.env.PG_BIN;
if (!bin && process.platform === "win32") {
  const base = join(tmpdir(), "embedded-pg");
  for (const entry of await readdir(base).catch(() => []))
    if (entry.startsWith("PG-")) {
      bin = join(base, entry, "bin");
      break;
    }
}
if (!bin)
  throw new Error(
    "Set PG_BIN to a local PostgreSQL bin directory (initdb, pg_ctl); no Java or Docker is needed. This runner never uses hosted credentials.",
  );
const work = await mkdtemp(join(tmpdir(), "achillea-test-")),
  data = join(work, "data");
const executable = (name: string) =>
  join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
function run(name: string, args: string[]) {
  const result = spawnSync(executable(name), args, {
    stdio: "ignore",
    windowsHide: true,
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(
      `${name} failed; see disposable directory ${work}: ${result.error || result.status}`,
    );
}
const port = await new Promise<number>((done, reject) => {
  const s = createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const address = s.address();
    if (!address || typeof address === "string")
      return reject(new Error("No local port"));
    s.close(() => done(address.port));
  });
});
run("initdb", [
  "-D",
  data,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
run("pg_ctl", [
  "-D",
  data,
  "-l",
  join(work, "postgres.log"),
  "-o",
  `-h 127.0.0.1 -p ${port}`,
  "-w",
  "start",
]);
const schema = "achillea_test_" + randomUUID().replaceAll("-", "");
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://127.0.0.1:${port}/postgres`,
  SPRING_DATASOURCE_URL: "",
  SPRING_DATASOURCE_USERNAME: "postgres",
  SPRING_DATASOURCE_PASSWORD: "",
  DB_SCHEMA: schema,
  ACHILLEA_TEST_MODE: "isolated",
  APP_ACCESS_PASSWORD: "isolated-test-password-123456",
  APP_SESSION_SECRET: "isolated-test-session-secret-12345678901234",
};
const db = new pg.Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "postgres",
});
try {
  await db.connect();
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}", pg_catalog`);
  // Apply the preserved migration bytes only to this new, disposable loopback database.
  for (const name of [
    "V1__relational_workflows.sql",
    "V2__external_simulation.sql",
  ])
    await db.query(
      await readFile(
        resolve("backend/src/main/resources/db/migration", name),
        "utf8",
      ),
    );
  await db.end();
  console.log(
    "Disposable native PostgreSQL ready; hosted environment variables are overridden.",
  );
  async function npm(args: string[], extra: Record<string, string> = {}) {
    // npm_execpath avoids shell command construction on Windows.
    const cli = process.env.npm_execpath;
    if (!cli) throw new Error("Run this script through npm run test:db");
    return new Promise<number>((done, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env: { ...env, ...extra },
        stdio: "inherit",
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("exit", (code) => done(code ?? 1));
    });
  }
  const code = await npm(["run", "test:api"]);
  process.exitCode = code;
  if (code === 0) {
    const httpPort = await new Promise<number>((done, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const a = s.address();
        if (!a || typeof a === "string") return reject(new Error("No port"));
        s.close(() => done(a.port));
      });
    });
    const base = `http://127.0.0.1:${httpPort}`;
    const app = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
      env: { ...env, PORT: String(httpPort) },
      stdio: "inherit",
      windowsHide: true,
    });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          ready = (await fetch(base + "/api/health")).ok;
        } catch {}
        if (ready) break;
        await new Promise((done) => setTimeout(done, 200));
      }
      if (!ready) throw new Error("Local Vite/function adapter did not start");
      process.exitCode = await npm(["test", "--workspace", "frontend"], {
        ACHILLEA_INTEGRATION_URL: base,
      });
    } finally {
      app.kill("SIGTERM");
      await new Promise<void>((done) => {
        if (app.exitCode !== null) return done();
        app.once("exit", () => done());
        setTimeout(() => {
          app.kill();
          done();
        }, 3000).unref();
      });
    }
  }
} finally {
  await db.end().catch(() => {});
  run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  console.log(
    "Disposable PostgreSQL stopped. Temporary test files retained at " + work,
  );
}
