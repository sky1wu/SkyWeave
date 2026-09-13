import { DateTime } from "luxon";
import { AmapClient } from "./client";
import { getConfig } from "./config";
import { TtlCache } from "./cache";
import {
  mapPoi,
  mapRoute,
  type MappedAlternative,
  formatAddress,
  parseLocation,
} from "./mapper";
import { tipSchema, stringValue } from "./types";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/geo/gcj02";
import { AppError } from "@/server/errors";
import { ApiError } from "./errors";
import type { Place, RouteRequest } from "./requests";
import { mockPlaces, mockRoutes } from "./test-provider";

export class AmapService {
  private cache = new TtlCache<unknown>(300);
  private pending = new Map<string, Promise<unknown>>();
  constructor(private client = new AmapClient(getConfig())) {}
  private async cached<T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    const operation = key.startsWith("[") ? "route" : key.split(":")[0];
    const record = (cacheHit: boolean, status = 200) => {
      if (process.env.NODE_ENV !== "test")
        console.info(
          JSON.stringify({
            requestId: crypto.randomUUID(),
            endpoint: "amap",
            provider: "amap",
            operation,
            duration: Math.round(performance.now() - started),
            status,
            cacheHit,
          }),
        );
    };
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      record(true);
      return hit as T;
    }
    const active = this.pending.get(key);
    if (active) return active as Promise<T>;
    const promise = fn()
      .then((result) => {
        this.cache.set(key, result, ttl);
        record(false);
        return result;
      })
      .catch((error) => {
        record(false, error instanceof AppError ? error.status : 502);
        throw error;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  search(q: string, city = ""): Promise<Place[]> {
    if (process.env.AMAP_TEST_MODE === "1")
      return Promise.resolve(mockPlaces(q));
    return this.cached(`search:${q}:${city}`, 120000, async () =>
      (
        await this.client.search({
          keywords: q,
          ...(city ? { region: city } : {}),
          show_fields: "business",
          page_size: "20",
        })
      ).pois
        .map(mapPoi)
        .filter((p): p is Place => !!p),
    );
  }
  details(id: string): Promise<Place> {
    if (process.env.AMAP_TEST_MODE === "1") {
      const p = mockPlaces("").find((p) => p.amapPoiId === id);
      if (!p)
        return Promise.reject(new AppError(404, "NOT_FOUND", "地点不存在"));
      return Promise.resolve(p);
    }
    return this.cached(`detail:${id}`, 3600000, async () => {
      const p = (
        await this.client.details({ id, show_fields: "business" })
      ).pois
        .map(mapPoi)
        .find(Boolean);
      if (!p) throw new AppError(404, "NOT_FOUND", "地点不存在或没有有效坐标");
      return p;
    });
  }
  autocomplete(q: string, city = ""): Promise<Place[]> {
    if (process.env.AMAP_TEST_MODE === "1")
      return Promise.resolve(mockPlaces(q));
    return this.cached(`tips:${q}:${city}`, 30000, async () => {
      const result = await this.client.autocomplete({
        keywords: q,
        ...(city ? { city } : {}),
        // Metro and bus stations are excluded by AMap's POI-only suggestions.
        datatype: "poi|bus",
      });
      return result.tips.flatMap((raw): Place[] => {
        const parsed = tipSchema.safeParse(raw);
        if (!parsed.success) return [];
        const t = parsed.data,
          id = stringValue(t.id),
          name = stringValue(t.name),
          point = parseLocation(t.location);
        if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id) || !name || !point)
          return [];
        const wgs = gcj02ToWgs84(point);
        return [
          {
            amapPoiId: id,
            name,
            address: formatAddress(t.district, t.address),
            lat: wgs.latitude,
            lng: wgs.longitude,
            types: [],
          },
        ];
      });
    });
  }
  private location(point: RouteRequest["origin"]) {
    const gcj = wgs84ToGcj02({ longitude: point.lng, latitude: point.lat });
    return `${gcj.longitude.toFixed(6)},${gcj.latitude.toFixed(6)}`;
  }
  key(request: RouteRequest) {
    return JSON.stringify([
      request.mode,
      this.location(request.origin),
      this.location(request.destination),
      request.origin.amapPoiId,
      request.destination.amapPoiId,
      request.departureTime
        ? Math.floor(Date.parse(request.departureTime) / 300000)
        : null,
    ]);
  }
  routes(request: RouteRequest): Promise<MappedAlternative[]> {
    if (process.env.AMAP_TEST_MODE === "1")
      return Promise.resolve(mockRoutes(request));
    return this.cached(
      this.key(request),
      ["walking", "cycling"].includes(request.mode) ? 300000 : 60000,
      async () => {
        const origin = this.location(request.origin),
          destination = this.location(request.destination);
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 17000);
        const city = (location: string) =>
          this.cached(`city:${location}`, 86400000, async () => {
            const result = await this.client.region(
              location,
              controller.signal,
            );
            const value = result.regeocode.addressComponent.citycode;
            return typeof value === "string" && /^\d{2,5}$/.test(value)
              ? value
              : null;
          });
        try {
          const parameters: Record<string, string> = {
            origin,
            destination,
            show_fields: "cost,polyline",
          };
          if (request.mode === "transit") {
            const [city1, city2] = await Promise.all([
              city(origin),
              city(destination),
            ]);
            if (!city1 || !city2) return [];
            Object.assign(parameters, {
              city1,
              city2,
              strategy: "0",
              AlternativeRoute: "10",
              nightflag: "1",
            });
            if (request.origin.amapPoiId && request.destination.amapPoiId)
              Object.assign(parameters, {
                originpoi: request.origin.amapPoiId,
                destinationpoi: request.destination.amapPoiId,
              });
            if (request.departureTime) {
              const time = DateTime.fromISO(request.departureTime).setZone(
                "Asia/Shanghai",
              );
              parameters.date = time.toFormat("yyyy-MM-dd");
              parameters.time = time.toFormat("H-mm");
            }
          } else {
            parameters[
              request.mode === "driving" ? "strategy" : "alternative_route"
            ] = request.mode === "driving" ? "32" : "3";
            if (request.mode !== "cycling") {
              if (request.origin.amapPoiId)
                parameters.origin_id = request.origin.amapPoiId;
              if (request.destination.amapPoiId)
                parameters.destination_id = request.destination.amapPoiId;
            }
          }
          const result = await this.client.directions(
            request.mode,
            parameters,
            controller.signal,
          );
          const candidates =
            request.mode === "transit"
              ? result.route.transits
              : result.route.paths;
          if (!candidates) throw new ApiError(502, "Missing routes");
          return candidates.flatMap((candidate) => {
            const mapped = mapRoute(candidate, request.mode === "transit");
            return mapped ? [mapped] : [];
          });
        } catch (error) {
          if (
            error instanceof ApiError &&
            ["20800", "20801", "20802", "20803"].includes(error.infocode ?? "")
          )
            return [];
          throw error;
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
      },
    );
  }
}
const globalAmap = globalThis as typeof globalThis & { tripAmap?: AmapService };
export const amap = globalAmap.tripAmap ?? new AmapService();
globalAmap.tripAmap = amap;
