export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function input(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ApiError(400, message);
}
export function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ApiError(409, message);
}
export function timestamp(
  value: string | null,
  name = "timestamp",
): string | undefined {
  if (value === null) return undefined;
  input(
    /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)),
    `Invalid ${name}`,
  );
  return new Date(value).toISOString();
}
export function boundedInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  if (value === null) return fallback;
  input(
    /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    "Invalid limit",
  );
  return Math.max(1, Math.min(Number(value), max));
}
