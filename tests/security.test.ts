import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticated, checkMutation, login, logout } from "../server/auth.js";
import { databaseConfig, databaseSchema } from "../server/db.js";
import { assertTestTarget } from "../scripts/test-data.js";
afterEach(() => vi.unstubAllEnvs());
function secrets() {
  vi.stubEnv("APP_ACCESS_PASSWORD", "unit-test-password-123456789");
  vi.stubEnv("APP_SESSION_SECRET", "unit-test-session-secret-123456789012345");
}
describe("session and configuration boundaries", () => {
  it("fails closed when authentication is not configured", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    expect(() => authenticated()).toThrow("Configure distinct");
  });
  it("requires distinct secrets", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "x".repeat(40));
    vi.stubEnv("APP_SESSION_SECRET", "x".repeat(40));
    expect(() => login("x".repeat(40))).toThrow("distinct");
  });
  it("rejects a wrong password and forged cookies", () => {
    secrets();
    expect(() => login("wrong")).toThrow("Invalid demo");
    expect(authenticated("achillea_session=forged.signature")).toBe(false);
  });
  it("issues an HttpOnly SameSite session and invalidates with secret rotation", () => {
    secrets();
    const cookie = login("unit-test-password-123456789");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(authenticated(cookie)).toBe(true);
    vi.stubEnv(
      "APP_SESSION_SECRET",
      "rotated-unit-test-session-secret-123456789",
    );
    expect(authenticated(cookie)).toBe(false);
    expect(logout()).toContain("Max-Age=0");
  });
  it("sets secure cookies on Vercel", () => {
    secrets();
    vi.stubEnv("VERCEL", "1");
    expect(login("unit-test-password-123456789")).toContain("; Secure");
  });
  it("rejects mutations missing the application header and foreign origins", () => {
    expect(() => checkMutation({})).toThrow("Same-origin");
    expect(() =>
      checkMutation({
        "x-achillea-request": "1",
        origin: "https://evil.example",
        host: "demo.example",
      }),
    ).toThrow("Origin");
    checkMutation({
      "x-achillea-request": "1",
      origin: "https://demo.example",
      host: "demo.example",
    });
  });
  it("preserves TLS verification when adapting a JDBC URL", () => {
    const config = databaseConfig({
      SPRING_DATASOURCE_URL:
        "jdbc:postgresql://db.example:30942/tsdb?sslmode=require&sslfactory=ignored",
      SPRING_DATASOURCE_USERNAME: "example",
      SPRING_DATASOURCE_PASSWORD: "test-placeholder",
    });
    expect(config.host).toBe("db.example");
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      servername: "db.example",
    });
    expect(config.max).toBe(3);
  });
  it("only disables TLS for explicitly isolated loopback tests", () => {
    expect(
      databaseConfig({
        DATABASE_URL: "postgresql://db.example/tsdb?sslmode=disable",
        ACHILLEA_TEST_MODE: "isolated",
      }).ssl,
    ).toMatchObject({ rejectUnauthorized: true });
    expect(
      databaseConfig({
        DATABASE_URL: "postgresql://127.0.0.1/postgres",
        ACHILLEA_TEST_MODE: "isolated",
      }).ssl,
    ).toBe(false);
  });
  it("rejects unsafe schema interpolation and connection limits", () => {
    expect(() =>
      databaseSchema({ DB_SCHEMA: "public; drop table patients" }),
    ).toThrow("Invalid");
    expect(() =>
      databaseConfig({
        DATABASE_URL: "postgresql://example/tsdb",
        DB_POOL_MAX: "9999",
      }),
    ).toThrow("1..20");
  });
  it("refuses test-data commands against hosted or normal application schemas", () => {
    vi.stubEnv("ACHILLEA_TEST_MODE", "isolated");
    vi.stubEnv("DATABASE_URL", "postgresql://host.example/tsdb");
    vi.stubEnv("DB_SCHEMA", "achillea_test_safe");
    expect(() => assertTestTarget()).toThrow("loopback");
    vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1/postgres");
    vi.stubEnv("DB_SCHEMA", "achillea");
    expect(() => assertTestTarget()).toThrow("isolated");
  });
});
