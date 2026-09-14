import { z } from "zod";
import type { Item } from "./types";

export const transportLabels = {
  train: "火车",
  flight: "飞机",
  coach: "长途汽车",
  ferry: "轮船",
  other: "其他交通",
} as const;

export const transportPointInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    sourcePlaceId: z.string().min(1).max(100).nullable().default(null),
    lat: z.number().finite().min(-90).max(90).nullable().default(null),
    lng: z.number().finite().min(-180).max(180).nullable().default(null),
    amapPoiId: z
      .string()
      .regex(/^[a-zA-Z0-9]{1,64}$/)
      .nullable()
      .default(null),
    address: z.string().max(2000).nullable().default(null),
  })
  .refine((p) => (p.lat === null) === (p.lng === null), "经纬度必须成对填写");
export const transportInput = z.strictObject({
  mode: z.enum(["train", "flight", "coach", "ferry", "other"]),
  status: z.enum(["tentative", "confirmed"]).default("tentative"),
  serviceNumber: z.string().trim().max(80).nullable().default(null),
  origin: transportPointInput,
  destination: transportPointInput,
  durationMinutes: z.number().int().min(0).max(10080).nullable().default(null),
});
export type TransportPlan = z.infer<typeof transportInput>;
export type TransportPoint = z.infer<typeof transportPointInput>;

export function routeEndpoint(
  item: Item,
  side: "arrival" | "departure",
): TransportPoint {
  if (item.transport)
    return side === "arrival"
      ? item.transport.origin
      : item.transport.destination;
  return {
    name: item.title,
    lat: item.lat,
    lng: item.lng,
    amapPoiId: item.amapPoiId,
    address: item.address,
    sourcePlaceId: item.sourcePlaceId,
  };
}

export function transportTiming(
  item: Item,
  arrival: number | null,
  dayStart?: number,
) {
  const plan = item.transport!;
  const warnings: string[] = [];
  const fixedStart = item.startMinutes === null ? null : item.startMinutes * 60;
  const fixedEnd = item.endMinutes === null ? null : item.endMinutes * 60;
  const duration =
    plan.durationMinutes === null ? null : plan.durationMinutes * 60;
  const lateMinutes =
    fixedStart !== null && arrival !== null
      ? Math.max(0, Math.ceil((arrival - fixedStart) / 60))
      : 0;
  const earlyMinutes =
    fixedStart !== null && arrival !== null
      ? Math.max(0, Math.ceil((fixedStart - arrival) / 60))
      : 0;
  const missed =
    lateMinutes > 0 ||
    (fixedEnd !== null && arrival !== null && arrival > fixedEnd);
  const start =
    fixedStart ?? (duration !== null ? (arrival ?? dayStart ?? null) : null);
  let departure =
    fixedEnd ?? (start !== null && duration !== null ? start + duration : null);
  if (missed) {
    warnings.push("预计赶不上此班次，后续到达时间不确定");
    departure = null;
  } else if (
    arrival === null &&
    dayStart === undefined &&
    (fixedStart !== null || fixedEnd !== null)
  ) {
    warnings.push("接驳到达时间不确定，后续按填写时间暂估");
  }
  if (departure === null && !missed) warnings.push("交通到达时间待定");
  return { start, departure, earlyMinutes, lateMinutes, warnings };
}
