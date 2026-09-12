import { isInAmapGcj02Region } from "./china";
import { isValidCoordinate, type Coordinate } from "./types";

const PI = Math.PI;
const AXIS = 6378245;
const ECCENTRICITY = 0.006693421622965943;

function offsetLatitude(x: number, y: number): number {
  return (
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x)) +
    ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3 +
    ((20 * Math.sin(y * PI) + 40 * Math.sin((y * PI) / 3)) * 2) / 3 +
    ((160 * Math.sin((y * PI) / 12) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  );
}

function offsetLongitude(x: number, y: number): number {
  return (
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x)) +
    ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3 +
    ((20 * Math.sin(x * PI) + 40 * Math.sin((x * PI) / 3)) * 2) / 3 +
    ((150 * Math.sin((x * PI) / 12) + 300 * Math.sin((x * PI) / 30)) * 2) / 3
  );
}

function transform(point: Coordinate): Coordinate {
  const rad = (point.latitude * PI) / 180;
  const magic = 1 - ECCENTRICITY * Math.sin(rad) ** 2;
  const sqrt = Math.sqrt(magic);
  return {
    longitude:
      point.longitude +
      (offsetLongitude(point.longitude - 105, point.latitude - 35) * 180) /
        ((AXIS / sqrt) * Math.cos(rad) * PI),
    latitude:
      point.latitude +
      (offsetLatitude(point.longitude - 105, point.latitude - 35) * 180) /
        (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrt)) * PI),
  };
}

function validate(point: Coordinate): void {
  if (!isValidCoordinate(point)) throw new RangeError("Invalid coordinate");
}

export function wgs84ToGcj02(point: Coordinate): Coordinate {
  validate(point);
  return isInAmapGcj02Region(point) ? transform(point) : { ...point };
}

export function gcj02ToWgs84(point: Coordinate): Coordinate {
  validate(point);
  if (!isInAmapGcj02Region(point)) return { ...point };
  let guess = { ...point };
  // Keep the coverage decision fixed during iteration, avoiding mask oscillation.
  for (let iteration = 0; iteration < 30; iteration++) {
    const projected = transform(guess);
    const dx = projected.longitude - point.longitude;
    const dy = projected.latitude - point.latitude;
    guess = { longitude: guess.longitude - dx, latitude: guess.latitude - dy };
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 1e-9) break;
  }
  return guess;
}
