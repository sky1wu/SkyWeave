export interface Coordinate {
  longitude: number;
  latitude: number;
}

export function isValidCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.longitude) <= 180 &&
    Math.abs(point.latitude) <= 90
  );
}
