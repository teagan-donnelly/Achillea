// Client for /api/handoffs (see HandoffService on the backend). Uses fetch directly (not api.ts)
// so callers can tell "this backend has no handoff API yet" (404 on the collection, or a
// non-JSON / non-list response) apart from ordinary validation and conflict errors.
import type { Handoff, HandoffDetail, HandoffSections, ShiftLabel } from "./handoff-types";

export class HandoffApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HandoffApiError";
  }
}

/** Raised when the running backend does not provide the handoff endpoints. */
export class HandoffUnavailableError extends HandoffApiError {
  constructor() {
    super("Handoff records need the updated backend", 404);
    this.name = "HandoffUnavailableError";
  }
}

export const UNAVAILABLE_MESSAGE = "Handoff records need the updated backend";

async function request<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HandoffApiError("Server unavailable", 0);
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    const status = response.status ?? 500;
    throw new HandoffApiError(error?.message ?? `Request failed (${status})`, status);
  }
  return (await response.json()) as T;
}

const isHandoff = (x: unknown): x is Handoff =>
  !!x && typeof x === "object" && typeof (x as Handoff).id === "string" && typeof (x as Handoff).status === "string";

export interface ListQuery {
  patientId?: string;
  status?: string;
  unit?: string;
}

/** GET /api/handoffs. A 404 or a response that is not a list means the endpoint does not exist. */
export async function listHandoffs(query: ListQuery = {}): Promise<Handoff[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  let data: unknown;
  try {
    data = await request<unknown>(`/handoffs${qs ? `?${qs}` : ""}`);
  } catch (e) {
    if (e instanceof HandoffApiError && (e.status === 404 || e.status === 405)) throw new HandoffUnavailableError();
    throw e;
  }
  if (!Array.isArray(data)) throw new HandoffUnavailableError();
  return data.filter(isHandoff);
}

export async function getHandoff(id: string): Promise<HandoffDetail> {
  const data = await request<HandoffDetail>(`/handoffs/${encodeURIComponent(id)}`);
  if (!data || !isHandoff(data.handoff)) throw new HandoffUnavailableError();
  return { handoff: data.handoff, versions: Array.isArray(data.versions) ? data.versions : [] };
}

export interface CreateHandoff {
  patientId: string;
  sections?: Partial<HandoffSections>;
  shiftLabel?: ShiftLabel;
  shiftDate?: string;
  receiverId?: string | null;
}

/** POST /api/handoffs: always starts a DRAFT. 409 when an open one exists for that patient + shift. */
export const createHandoff = (body: CreateHandoff) => request<Handoff>("/handoffs", body);

/** PATCH /api/handoffs/{id}: DRAFT only; the backend appends a version, nothing is overwritten. */
export const saveHandoffDraft = (id: string, body: { sections?: Partial<HandoffSections>; receiverId?: string | null }) =>
  request<Handoff>(`/handoffs/${encodeURIComponent(id)}`, body, "PATCH");

export const markHandoffReady = (id: string) => request<Handoff>(`/handoffs/${encodeURIComponent(id)}/ready`, {});
export const markHandoffReviewed = (id: string) => request<Handoff>(`/handoffs/${encodeURIComponent(id)}/review`, {});
/** Acknowledgment is always an explicit, verified nurse action. */
export const acknowledgeHandoff = (id: string) =>
  request<Handoff>(`/handoffs/${encodeURIComponent(id)}/acknowledge`, { verified: true });
