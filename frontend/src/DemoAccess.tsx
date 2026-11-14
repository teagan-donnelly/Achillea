import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export function DemoAccess({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{
      required: boolean;
      authenticated: boolean;
    } | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    try {
      setSession(await api("/session"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot check demo access");
    }
  }, []);
  useEffect(() => {
    void check();
    const expired = () => {
      setSession({ required: true, authenticated: false });
      setPassword("");
    };
    window.addEventListener("achillea:unauthorized", expired);
    return () => window.removeEventListener("achillea:unauthorized", expired);
  }, [check]);
  if (!session || (session.required && !session.authenticated))
    return (
      <main className="demo-access">
        <h1>Achillea</h1>
        <p>
          Protected educational demonstration. All patient records are
          synthetic.
        </p>
        {error && <p role="alert">{error}</p>}
        {!session ? (
          <>
            <p role="status">Checking demo access…</p>
            <button onClick={() => void check()}>Retry connection</button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              void api("/session", { password })
                .then(() => {
                  setPassword("");
                  return check();
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "Sign-in failed"),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Demo access password
              <input
                type="password"
                required
                autoComplete="current-password"
                maxLength={512}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={busy || !password}>Open synthetic demo</button>
            <p>
              Ask the project owner for demo access. Database and simulator
              credentials do not belong here.
            </p>
          </form>
        )}
      </main>
    );
  return (
    <>
      {session.required && (
        <div className="demo-access-bar">
          <span>Protected synthetic demo</span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api("/session", undefined, "DELETE")
                .then(() =>
                  setSession({ required: true, authenticated: false }),
                )
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "Sign-out failed"),
                )
                .finally(() => setBusy(false));
            }}
          >
            Sign out
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
      {children}
    </>
  );
}
