import { AppError } from "../errors";
import { access, readTx, tripSequence } from "../service-core";
import { z } from "zod";
import { tripSections } from "@/domain/types";
import type { Member } from "@/domain/types";
import { many } from "../db";
import {
  createTrip,
  deleteTrip,
  editTrip,
  listTrips,
  reorderDays,
  snapshot,
} from "../trip-service";
import { expectedVersion, UNHANDLED, type ApiDispatcher } from "./dispatcher";
import {
  createItineraryShare,
  getItineraryShare,
  revokeItineraryShare,
} from "../itinerary-share-service";

export const dispatchTrip: ApiDispatcher = ({
  root,
  id,
  action,
  subId,
  method,
  user,
  data,
  path,
  url,
}) => {
  if (
    root === "trips" &&
    id &&
    action === "revision" &&
    path.length === 3 &&
    method === "GET"
  ) {
    return readTx(() => {
      access(id, user);
      return {
        sequence: tripSequence(id),
        // Profile edits live in Better Auth, outside the trip's activity log.
        members: many<Pick<Member, "userId" | "name" | "email">>(
          "SELECT m.userId, u.name, u.email FROM trip_members m JOIN users u ON u.id=m.userId WHERE m.tripId=?",
          id,
        ),
      };
    });
  }
  if (root === "trips" && id && action === "share") {
    if (path.length === 3 && method === "GET")
      return getItineraryShare(id, user);
    if (path.length === 3 && method === "POST")
      return createItineraryShare(id, user);
    if (path.length === 4 && method === "DELETE")
      return revokeItineraryShare(id, subId, user);
    return UNHANDLED;
  }
  if (root === "trips" && !id) {
    if (method === "GET") return listTrips(user);
    if (method === "POST") return createTrip(user, data);
  } else if (root === "trips" && id && !action) {
    if (method === "GET")
      return snapshot(
        id,
        user,
        z
          .enum(tripSections)
          .optional()
          .parse(url.searchParams.get("section") ?? undefined),
      );
    if (method === "PATCH") return editTrip(id, user, data);
    if (method === "DELETE") return deleteTrip(id, user, expectedVersion(data));
  } else if (root === "trips" && action === "days" && method === "POST") {
    if (subId === "reorder") return reorderDays(id, user, data);
    access(id, user, "edit");
    throw new AppError(
      405,
      "CALENDAR_MANAGED",
      "请在行程设置中调整天数或日期范围",
    );
  }
  return UNHANDLED;
};
