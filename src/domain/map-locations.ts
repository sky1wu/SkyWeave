import type { DayPlan, PoolPlace } from "./types";
import { typeLabels } from "./types";
import { located } from "./timeline";
import { transportLabels } from "./transport";
import { poolPlaceCounts } from "./planning";
import { branchesOf, displayItems, planningItems } from "./parallel";

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
  branchTitle?: string;
  color?: string;
}

export function mapLocations(
  day: DayPlan | undefined,
  pool: PoolPlace[],
  days: DayPlan[],
): MapLocation[] {
  const scheduled = poolPlaceCounts(days);
  const result: MapLocation[] = [];
  const branches = day ? branchesOf(day) : [];
  for (const [index, item] of (day ? displayItems(day) : []).entries()) {
    const branch = branches.find((b) => b.id === item.branchId);
    const group = branch
      ? { branchTitle: branch.title, color: branch.color }
      : {};
    if (item.type === "note" || item.type === "parallel") continue;
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
            ...group,
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
        ...group,
      });
  }
  for (const leg of day?.legs ?? []) {
    if (result.some((point) => point.itemId === leg.fromItemId)) continue;
    const origin =
      day && planningItems(day).find((item) => item.id === leg.fromItemId);
    if (!origin) continue;
    const point = origin.transport?.destination ?? origin;
    if (!located(point)) continue;
    const group = branches.find((b) => b.id === leg.branchId);
    result.push({
      id: origin.transport ? `${origin.id}:destination` : origin.id,
      itemId: origin.id,
      title: `${origin.transport?.destination.name ?? origin.title}（跨日出发）`,
      category: origin.placeCategory,
      lat: point.lat!,
      lng: point.lng!,
      ...(origin.transport ? { endpoint: "destination" as const } : {}),
      branchTitle: group?.title,
      color: group?.color,
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
