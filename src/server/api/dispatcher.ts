import { z } from "zod";
import type { Actor } from "../service-core";

export const UNHANDLED = Symbol("UNHANDLED");

export interface ApiRequestContext {
  request: Request;
  path: string[];
  root: string;
  id: string;
  action: string;
  subId: string;
  method: string;
  url: URL;
  user: Actor;
  data: unknown;
}

export type ApiDispatchResult = unknown | Response | typeof UNHANDLED;
export type ApiDispatcher = (
  context: ApiRequestContext,
) => ApiDispatchResult | Promise<ApiDispatchResult>;

export function expectedVersion(data: unknown) {
  return z.object({ expectedVersion: z.number().int().positive() }).parse(data)
    .expectedVersion;
}
