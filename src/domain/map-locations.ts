import type { DayPlan, PoolPlace } from "./types";
import { typeLabels } from "./types";
import { located } from "./timeline";
import { transportLabels } from "./transport";
import { poolPlaceCounts } from "./planning";

export interface MapLocation {
  id: string;
  itemId?: string;
  poolPlaceId?: string;
  sourcePlaceId?: string | null;
  endpoint?: "origin" | "destination";
  title: string;
  category: string;
  lat: number;
  lng: number;
  number?: number;
}

export function mapLocations(
  day: DayPlan | undefined,
  pool: PoolPlace[],
  days: DayPlan[],
): MapLocation[] {
  const scheduled = poolPlaceCounts(days);
  const result: MapLocation[] = [];
  for (const [index, item] of (day?.items ?? []).entries()) {
    if (item.type === "note") continue;
    if (item.transport) {
      for (const endpoint of ["origin", "destination"] as const) {
        const point = item.transport[endpoint];
        if (located(point))
          result.push({
            id: `${item.id}:${endpoint}`,
            itemId: item.id,
            sourcePlaceId: point.sourcePlaceId,
            endpoint,
            title: point.name,
            category: transportLabels[item.transport.mode],
            lat: point.lat!,
            lng: point.lng!,
            number: index + 1,
          });
      }
    } else if (located(item))
      result.push({
        id: item.id,
        itemId: item.id,
        sourcePlaceId: item.sourcePlaceId,
        title: item.title,
        category:
          item.placeCategory === "未分类"
            ? typeLabels[item.type]
            : item.placeCategory,
        lat: item.lat!,
        lng: item.lng!,
        number: index + 1,
      });
  }
  for (const place of pool)
    if (!scheduled.has(place.id) && place.type !== "note" && located(place))
      result.push({
        id: `pool:${place.id}`,
        poolPlaceId: place.id,
        title: place.title,
        category:
          place.placeCategory === "未分类"
            ? typeLabels[place.type]
            : place.placeCategory,
        lat: place.lat!,
        lng: place.lng!,
      });
  return result;
}
