import geometry from "./amap-gcj02-region.json";
import { isValidCoordinate, type Coordinate } from "./types";

type Ring = readonly (readonly number[])[];
const METRES_PER_DEGREE = 111320;

// AMap covers coastal POIs too. Natural Earth's generalized land polygons omit
// some waterfront/reclaimed sites, and GCJ offsets can cross the WGS84 coastline.
// Limit this allowance to HKG/MAC/TWN; do not widen mainland foreign borders.
const COASTAL_ALLOWANCE_METRES = 1000;

function nearRing(point: Coordinate, ring: Ring, allowance: number): boolean {
  const scaleX = METRES_PER_DEGREE * Math.cos((point.latitude * Math.PI) / 180);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined
    )
      continue;
    const x = (ax - point.longitude) * scaleX;
    const y = (ay - point.latitude) * METRES_PER_DEGREE;
    const dx = (bx - ax) * scaleX;
    const dy = (by - ay) * METRES_PER_DEGREE;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared));
    if ((x + t * dx) ** 2 + (y + t * dy) ** 2 <= allowance ** 2) return true;
  }
  return false;
}

function inRing(point: Coordinate, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined
    )
      continue;
    if (
      ay > point.latitude !== by > point.latitude &&
      point.longitude < ((bx - ax) * (point.latitude - ay)) / (by - ay) + ax
    )
      inside = !inside;
  }
  return inside;
}

// Each island gets its own bounding box, avoiding a scan of every coastline vertex.
const polygons = geometry.features.flatMap((feature) => {
  // Hong Kong and Macao include harbours and reclaimed airports. Treat each as
  // one operational envelope, rather than requiring POIs to lie on old land.
  const envelope = ["HKG", "MAC"].includes(feature.properties.code);
  const groups = envelope
    ? [feature.geometry.coordinates.flat()]
    : feature.geometry.coordinates;
  return groups.map((rings) => {
    const points = envelope ? rings.flat() : (rings[0] ?? []);
    const xs = points.map((p) => p[0] ?? 0);
    const ys = points.map((p) => p[1] ?? 0);
    const allowance =
      feature.properties.code === "CHN" ? 0 : COASTAL_ALLOWANCE_METRES;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const latitudePadding = allowance / METRES_PER_DEGREE;
    const longitudePadding =
      latitudePadding /
      Math.cos((Math.max(Math.abs(minY), Math.abs(maxY)) * Math.PI) / 180);
    return {
      rings,
      envelope,
      allowance,
      minX: Math.min(...xs) - longitudePadding,
      maxX: Math.max(...xs) + longitudePadding,
      minY: minY - latitudePadding,
      maxY: maxY + latitudePadding,
    };
  });
});

/** AMap GCJ-02 coverage includes the mainland, Hainan, Hong Kong, Macao and Taiwan.
 * Policy: https://lbs.amap.com/faq/advisory/others/39840/
 * Natural Earth is approximate near coastlines/borders; see coordinate-validation.md.
 */
export function isInAmapGcj02Region(point: Coordinate): boolean {
  if (!isValidCoordinate(point)) return false;
  return polygons.some(
    ({ rings, envelope, allowance, minX, maxX, minY, maxY }) => {
      if (
        point.longitude < minX ||
        point.longitude > maxX ||
        point.latitude < minY ||
        point.latitude > maxY
      )
        return false;
      if (envelope) return true;
      const outer = rings[0];
      return Boolean(
        outer &&
        (inRing(point, outer) ||
          (allowance > 0 && nearRing(point, outer, allowance))) &&
        !rings.slice(1).some((ring) => inRing(point, ring)),
      );
    },
  );
}
