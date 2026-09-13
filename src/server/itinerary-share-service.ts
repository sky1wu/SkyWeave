import { randomBytes } from "node:crypto";
import {
  itineraryDateRange,
  itineraryDays,
  type ItineraryDocument,
  type ItineraryShare,
} from "@/domain/itinerary";
import { insert, many, one, run } from "./db";
import { AppError } from "./errors";
import {
  access,
  getDay,
  getTrip,
  log,
  tx,
  uid,
  type Actor,
} from "./service-core";

function currentShare(tripId: string) {
  return (
    one<ItineraryShare>(
      "SELECT id, token, createdAt FROM itinerary_shares WHERE tripId=?",
      tripId,
    ) ?? null
  );
}

export function getItineraryShare(tripId: string, actor: Actor) {
  return tx(() => {
    access(tripId, actor, "owner");
    return { share: currentShare(tripId) };
  });
}

export function createItineraryShare(tripId: string, actor: Actor) {
  return tx(() => {
    access(tripId, actor, "owner");
    const existing = currentShare(tripId);
    if (existing) return { share: existing };
    const share: ItineraryShare = {
      id: uid(),
      token: randomBytes(32).toString("base64url"),
      createdAt: Date.now(),
    };
    insert("itinerary_shares", { ...share, tripId, createdByUserId: actor.id });
    log(
      tripId,
      actor,
      "itinerary.shared",
      "itinerary_share",
      share.id,
      "开启了行程公开分享",
    );
    return { share };
  });
}

export function revokeItineraryShare(
  tripId: string,
  shareId: string,
  actor: Actor,
) {
  return tx(() => {
    access(tripId, actor, "owner");
    const result = run(
      "DELETE FROM itinerary_shares WHERE tripId=? AND id=?",
      tripId,
      shareId,
    );
    if (result.changes)
      log(
        tripId,
        actor,
        "itinerary.unshared",
        "itinerary_share",
        shareId,
        "取消了行程公开分享",
      );
    return { deleted: true };
  });
}

export function sharedItinerary(token: string): ItineraryDocument {
  return tx(() => {
    const share = /^[A-Za-z0-9_-]{43}$/.test(token)
      ? one<{ tripId: string }>(
          "SELECT tripId FROM itinerary_shares WHERE token=?",
          token,
        )
      : undefined;
    if (!share)
      throw new AppError(404, "SHARE_UNAVAILABLE", "分享链接已取消或不存在");
    const trip = getTrip(share.tripId);
    const days = many<{ id: string }>(
      "SELECT id FROM days WHERE tripId=? ORDER BY position, id",
      trip.id,
    ).map((day) => getDay(day.id));
    // Return only the rendered handbook, never the private trip snapshot.
    return {
      title: trip.title,
      dates: itineraryDateRange(trip.startDate, trip.endDate),
      timezone: trip.timezone,
      days: itineraryDays(days),
    };
  });
}
