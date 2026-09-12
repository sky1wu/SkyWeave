import type { Place, RouteRequest } from "./requests";
import type { MappedAlternative } from "./mapper";
// Explicit opt-in test provider. Missing production keys never enable fixtures.
const places: Place[] = [
  ["X001", "西安酒店", 34.255, 108.941],
  ["X002", "西安SKP", 34.249147399, 108.944073101],
  ["X003", "大唐不夜城", 34.2108, 108.961],
  ["X004", "大雁塔", 34.219, 108.9603],
  ["X005", "钟楼", 34.2602, 108.9424],
  ["H001", "电玩鲸电竞民宿（深圳皇岗口岸店）", 22.524, 114.07],
  ["H002", "福田口岸", 22.5166, 114.064],
  ["H003", "落马洲站", 22.5148, 114.0657],
  ["H004", "INCUBASE Arena", 22.337, 114.148],
  ["H005", "MUJI 旺角", 22.319, 114.169],
  ["H006", "星光大道", 22.293, 114.173],
  ["H007", "中环", 22.282, 114.158],
  ["H008", "AsiaWorld-Expo", 22.321, 113.943],
  ["H009", "皇岗口岸", 22.518, 114.074],
].map(([amapPoiId, name, lat, lng]) => ({
  amapPoiId: String(amapPoiId),
  name: String(name),
  lat: Number(lat),
  lng: Number(lng),
  address: String(amapPoiId).startsWith("X")
    ? "陕西省西安市 · 测试地点"
    : "深圳 / 香港 · 测试地点",
  rating: 4.8,
  types: [],
}));
export function mockPlaces(q: string): Place[] {
  return places.filter(
    (p) => !q || p.name.toLowerCase().includes(q.toLowerCase()),
  );
}
export function mockRoutes(r: RouteRequest): MappedAlternative[] {
  return Array.from({ length: r.mode === "transit" ? 3 : 1 }, (_, i) => ({
    provider: "amap",
    fingerprint: `test-${r.mode}-${i}`,
    distanceMeters: 5900 + i * 300,
    durationSeconds:
      (r.mode === "walking"
        ? 27
        : r.mode === "cycling"
          ? 18
          : r.mode === "driving"
            ? 16
            : 42 + i * 4) * 60,
    walkingDistanceMeters: r.mode === "transit" ? 800 - i * 150 : null,
    transferCount: r.mode === "transit" ? Math.max(0, 1 - i) : null,
    polyline: [
      [r.origin.lng, r.origin.lat],
      [
        (r.origin.lng + r.destination.lng) / 2 + i * 0.001,
        (r.origin.lat + r.destination.lat) / 2,
      ],
      [r.destination.lng, r.destination.lat],
    ],
    geometryComplete: true,
    steps: [
      {
        mode: r.mode,
        instruction:
          r.mode === "transit" ? "测试地铁线路 → 目的地" : "测试路线",
      },
    ],
    summary:
      r.mode === "transit"
        ? ["东铁线 → 观塘线", "公交 → 地铁", "少换乘方案"][i]
        : `${r.mode} 测试路线`,
  }));
}
