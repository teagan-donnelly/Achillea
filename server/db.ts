import pg, { type PoolClient, type PoolConfig } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { ApiError } from "./errors.js";

export function databaseConfig(env = process.env): PoolConfig {
  const raw = env.DATABASE_URL || env.SPRING_DATASOURCE_URL;
  if (!raw)
    throw new ApiError(
      503,
      "Configure the server-side PostgreSQL database connection",
    );
  const url = new URL(raw.replace(/^jdbc:/, ""));
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new ApiError(503, "PostgreSQL connection required");
  const localTest =
    env.ACHILLEA_TEST_MODE === "isolated" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  // Parse explicitly: pg connection-string sslmode can otherwise override TLS options.
  const ssl = localTest
    ? false
    : {
        rejectUnauthorized: true,
        servername: url.hostname,
        ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {}),
      };
  const max = Number(env.DB_POOL_MAX || 3);
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new ApiError(503, "DB_POOL_MAX must be 1..20");
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: env.SPRING_DATASOURCE_USERNAME || decodeURIComponent(url.username),
    password:
      env.SPRING_DATASOURCE_PASSWORD || decodeURIComponent(url.password),
    ssl,
    max,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    application_name: "achillea-vercel",
  };
}
export function databaseSchema(env = process.env): string {
  const schema = env.DB_SCHEMA || "achillea";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new ApiError(503, "Invalid database schema");
  if (
    env.ACHILLEA_TEST_MODE === "isolated" &&
    !/^achillea_test_[a-z0-9_]+$/.test(schema)
  )
    throw new ApiError(503, "Tests require an isolated achillea_test_* schema");
  return schema;
}
let pool: pg.Pool | undefined;
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(databaseConfig());
    pool.on("error", () => {
      console.error("PostgreSQL idle connection failed");
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
  write = false,
): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query(
      write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await db.query(
      `SET LOCAL search_path TO "${databaseSchema()}", pg_catalog`,
    );
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query("SET LOCAL statement_timeout='15s'");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
