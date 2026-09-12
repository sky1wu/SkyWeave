import { z } from "zod";
import { createHash } from "node:crypto";
import { gcj02ToWgs84 } from "@/geo/gcj02";
import { poiSchema, stringValue } from "./types";
import type { Place } from "./requests";
import type { Alternative } from "@/domain/types";
export const routeEnvelopeSchema = z.object({
  route: z.object({
    paths: z.array(z.unknown()).max(20).optional(),
    transits: z.array(z.unknown()).max(20).optional(),
  }),
});
export function parseLocation(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(v)
  )
    return;
  const [lng, lat] = v.split(",").map(Number);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return;
  return { latitude: lat, longitude: lng };
}
export function formatAddress(...values: unknown[]): string {
  let address = "";
  for (const value of values) {
    const part = stringValue(value);
    if (!part || address.includes(part)) continue;
    if (part.startsWith(address)) {
      address = part;
      continue;
    }
    let overlap = Math.min(address.length, part.length);
    while (overlap > 0 && !address.endsWith(part.slice(0, overlap))) overlap--;
    address += part.slice(overlap);
  }
  return address;
}
export function mapPoi(raw: unknown): Place | undefined {
  const parsed = poiSchema.safeParse(raw);
  if (!parsed.success) return;
  const p = parsed.data;
  const id = stringValue(p.id),
    name = stringValue(p.name),
    point = parseLocation(p.location);
  if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id) || !name || !point) return;
  const coord = gcj02ToWgs84(point);
  const rating = Number(p.business?.rating);
  return {
    amapPoiId: id,
    name,
    address: formatAddress(p.pname, p.cityname, p.adname, p.address),
    lat: coord.latitude,
    lng: coord.longitude,
    types: stringValue(p.typecode)?.split("|") ?? [],
    ...(rating > 0 && rating <= 5 ? { rating } : {}),
    ...(stringValue(p.business?.tel)
      ? { phone: stringValue(p.business?.tel) }
      : {}),
  };
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined =>
  (typeof v === "number" ||
    (typeof v === "string" && /^\d+(\.\d+)?$/.test(v))) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : undefined;
const clean = (v: unknown) =>
  typeof v === "string"
    ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 300)
    : "";
export type MappedAlternative = Omit<
  Alternative,
  "id" | "travelLegId" | "position" | "label" | "fetchedAt"
>;
export function mapRoute(
  raw: unknown,
  transit: boolean,
): MappedAlternative | undefined {
  const route = obj(raw),
    distance = num(route.distance),
    duration = num(obj(route.cost).duration) ?? num(route.duration);
  if (distance === undefined || duration === undefined) return;
  const polyline: [number, number][] = [],
    steps: Alternative["steps"] = [],
    names: string[] = [];
  let complete = true,
    walking = 0,
    rides = 0;
  const add = (part: Obj, mode: string, instruction: string) => {
    const geometry =
      typeof part.polyline === "string"
        ? part.polyline
        : obj(part.polyline).polyline;
    if (typeof geometry !== "string" || !geometry) {
      if (num(part.distance ?? part.step_distance) !== 0) complete = false;
    } else
      for (const pair of geometry.split(";")) {
        const point = parseLocation(pair);
        if (!point) {
          complete = false;
          continue;
        }
        const wgs = gcj02ToWgs84(point);
        const last = polyline.at(-1);
        if (!last || last[0] !== wgs.longitude || last[1] !== wgs.latitude)
          polyline.push([wgs.longitude, wgs.latitude]);
        if (polyline.length > 10000) {
          complete = false;
          break;
        }
      }
    steps.push({
      mode,
      instruction,
      distanceMeters: num(part.distance ?? part.step_distance),
      durationSeconds: num(obj(part.cost).duration) ?? num(part.duration),
    });
  };
  if (transit) {
    const segments = list(route.segments);
    if (!segments.length) complete = false;
    for (const input of segments) {
      const segment = obj(input);
      if (!Object.keys(segment).length) continue;
      const walk = obj(segment.walking);
      walking += num(walk.distance) ?? 0;
      if (
        Object.keys(walk).length &&
        !list(walk.steps).length &&
        num(walk.distance) !== 0
      )
        complete = false;
      for (const step of list(walk.steps))
        add(obj(step), "walking", clean(obj(step).instruction) || "步行");
      const buslines = list(obj(segment.bus).buslines);
      if (Object.keys(obj(segment.bus)).length && !buslines.length)
        complete = false;
      if (buslines.length) {
        const line = obj(buslines[0]);
        const name = clean(line.name) || "公共交通";
        names.push(name);
        rides++;
        add(
          line,
          "transit",
          `${name}${clean(obj(line.departure_stop).name) ? ` · ${clean(obj(line.departure_stop).name)} → ${clean(obj(line.arrival_stop).name)}` : ""}`,
        );
      }
      for (const key of ["railway", "taxi"])
        if (Object.keys(obj(segment[key])).length) {
          const part = obj(segment[key]);
          const name =
            clean(part.name) || (key === "railway" ? "铁路" : "出租车");
          names.push(name);
          rides++;
          add(part, key, name);
        }
    }
  } else {
    const routeSteps = list(route.steps);
    if (!routeSteps.length) complete = false;
    for (const s of routeSteps)
      add(
        obj(s),
        "route",
        clean(obj(s).instruction) || clean(obj(s).road) || "沿路线行进",
      );
  }
  complete = complete && polyline.length >= 2 && polyline.length <= 10000;
  const summary = names.length
    ? names.join(" → ")
    : transit
      ? "公共交通方案"
      : steps
          .map((s) => s.instruction)
          .slice(0, 3)
          .join(" → ") || "高德推荐路线";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([transit, names, steps.map((s) => s.instruction)]))
    .digest("hex")
    .slice(0, 24);
  return {
    provider: "amap",
    fingerprint,
    distanceMeters: Math.round(distance),
    durationSeconds: Math.ceil(duration),
    walkingDistanceMeters: transit ? Math.round(walking) : null,
    transferCount: transit ? Math.max(0, rides - 1) : null,
    polyline: complete ? polyline : [],
    geometryComplete: complete,
    steps,
    summary,
  };
}
