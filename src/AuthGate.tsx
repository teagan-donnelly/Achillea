import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export function AuthGate({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ authenticated: boolean; authEnabled?: boolean }>("/auth/session")
      .then((s) => {
        if (active) {
          setAuthEnabled(s.authEnabled !== false);
          setSignedIn(s.authenticated);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Sign-in unavailable");
          setSignedIn(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  if (!authEnabled) return <>{children}</>;
  if (signedIn === null)
    return (
      <main className="login">
        <p role="status">Checking your session…</p>
      </main>
    );
  if (signedIn)
    return (
      <>
        {children}
        <button
          className="session-logout secondary"
          onClick={() => {
            void api("/auth/session", {}, "DELETE")
              .then(() => {
                sessionStorage.clear();
                setSignedIn(false);
              })
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Sign-out failed"),
              );
          }}
        >
          Sign out
        </button>
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <main className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/auth/session", { password });
            setPassword("");
            setSignedIn(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Sign-in failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="eyebrow">ACHILLEA</p>
        <h1>Open your demo shift</h1>
        <p>
          Synthetic records only. Use the private demo password supplied by your
          team.
        </p>
        <label>
          Demo password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
