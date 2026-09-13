import type { MutableRefObject } from "react";

export type Mutate = <T = { id: string }>(
  path: string,
  method: string,
  data: unknown,
) => Promise<T>;

export type PlannerView = "pool" | "timeline" | "map";

export interface DropTarget {
  dayId: string;
  beforeItemId: string | null;
}

export type InteractionSequence = MutableRefObject<number>;

export type PlannerAction = (fn: () => Promise<unknown>) => Promise<void>;
