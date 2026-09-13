import { AppError } from "../errors";
import { access } from "../service-core";
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
}) => {
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
    if (method === "GET") return snapshot(id, user);
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
