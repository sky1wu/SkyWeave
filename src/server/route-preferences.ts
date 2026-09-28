import type { Leg, Mode } from "@/domain/types";
import { one, run } from "./db";

type LegSettings = Pick<
  Leg,
  | "mode"
  | "manualDurationMinutes"
  | "manualDistanceMeters"
  | "manualDescription"
>;

export function defaultRouteMode(tripId: string): Mode {
  return (
    one<{ mode: Mode }>(
      "SELECT mode FROM trip_route_preferences WHERE tripId=?",
      tripId,
    )?.mode ?? "transit"
  );
}

export function rememberRouteMode(tripId: string, mode: Mode) {
  run(
    "INSERT INTO trip_route_preferences (tripId, mode) VALUES (?, ?) ON CONFLICT (tripId) DO UPDATE SET mode=excluded.mode",
    tripId,
    mode,
  );
}

export function isAutomaticSamePlaceLeg(leg: LegSettings) {
  return (
    leg.mode === "manual" &&
    leg.manualDurationMinutes === 0 &&
    leg.manualDistanceMeters === 0 &&
    leg.manualDescription === "同一地点，无需移动"
  );
}

// Keep settings independently of active legs; route results must be recalculated.
export function rememberLegSettings(leg: Leg) {
  if (isAutomaticSamePlaceLeg(leg)) return;
  run(
    `INSERT INTO travel_leg_preferences
      (fromItemId, toItemId, branchId, routeRole, mode, manualDurationMinutes, manualDistanceMeters, manualDescription)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (fromItemId, toItemId, branchId, routeRole) DO UPDATE SET
        mode=excluded.mode,
        manualDurationMinutes=excluded.manualDurationMinutes,
        manualDistanceMeters=excluded.manualDistanceMeters,
        manualDescription=excluded.manualDescription`,
    leg.fromItemId,
    leg.toItemId,
    leg.branchId ?? "",
    leg.routeRole ?? "main",
    leg.mode,
    leg.manualDurationMinutes,
    leg.manualDistanceMeters,
    leg.manualDescription,
  );
}

export function rememberedLegSettings(
  fromItemId: string,
  toItemId: string,
  branchId: string,
  routeRole: NonNullable<Leg["routeRole"]>,
): LegSettings | undefined {
  return one<LegSettings>(
    `SELECT mode, manualDurationMinutes, manualDistanceMeters, manualDescription
      FROM travel_leg_preferences
      WHERE fromItemId=? AND toItemId=? AND branchId=? AND routeRole=?`,
    fromItemId,
    toItemId,
    branchId,
    routeRole,
  );
}
