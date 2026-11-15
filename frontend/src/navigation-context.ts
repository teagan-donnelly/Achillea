// Carry the primary entry point through focused patient workflows.
export function patientReturnState(location: {
  pathname: string;
  state: unknown;
}) {
  const state = location.state as { from?: unknown } | null;
  const primary = ["/", "/activity", "/patients", "/sensors", "/rounds", "/settings", "/repositioning"];
  const from = primary.includes(location.pathname)
    ? location.pathname
    : typeof state?.from === "string" && primary.includes(state.from)
      ? state.from
      : "/patients";
  return { from };
}
