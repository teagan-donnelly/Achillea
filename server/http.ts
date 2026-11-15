import type { IncomingMessage, ServerResponse } from "node:http";
// The Node Vercel handler contract needs no runtime SDK dependency.
export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}
export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(value: unknown): ApiResponse;
}
