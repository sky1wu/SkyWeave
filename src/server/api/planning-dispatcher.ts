import { z } from "zod";
import { amap } from "@/amap/service";
import { routeRequestSchema } from "@/amap/requests";
import type { Leg } from "@/domain/types";
import { one } from "../db";
import { AppError, requireValue } from "../errors";
import {
  deletePoolPlace,
  moveItem,
  reorderPoolPlaces,
  savePoolPlace,
  schedulePlace,
} from "../places";
import {
  createItem,
  deleteItem,
  editDay,
  editItem,
  editLeg,
  getDay,
  reorder,
} from "../planning-service";
import { calculateDay, calculateLeg } from "../routing";
import { access, uid } from "../service-core";
import { snapshot } from "../trip-service";
import { expectedVersion, UNHANDLED, type ApiDispatcher } from "./dispatcher";

export const dispatchPlanning: ApiDispatcher = async ({
  path,
  root,
  id,
  action,
  subId,
  method,
  url,
  user,
  data,
}) => {
  if (root === "trips" && action === "places") {
    if (method === "GET" && !subId) return snapshot(id, user).poolPlaces;
    if (method === "POST" && !subId) return savePoolPlace(id, user, data);
    if (method === "POST" && subId === "reorder" && path.length === 4)
      return reorderPoolPlaces(id, user, data);
    if (method === "PATCH" && subId)
      return savePoolPlace(id, user, data, subId);
    if (method === "DELETE" && subId)
      return deletePoolPlace(id, subId, user, expectedVersion(data));
    if (method === "POST" && subId && path[4] === "schedule")
      return schedulePlace(id, subId, user, data);
  } else if (root === "days" && id && !action) {
    if (method === "GET") {
      const day = getDay(id);
      access(day.tripId, user);
      return day;
    }
    if (method === "PATCH") return editDay(id, user, data);
    if (method === "DELETE") {
      access(getDay(id).tripId, user, "edit");
      throw new AppError(
        405,
        "CALENDAR_MANAGED",
        "请在行程设置中调整天数或日期范围",
      );
    }
  } else if (root === "days" && action === "items" && method === "POST")
    return createItem(id, user, data);
  else if (root === "days" && action === "reorder" && method === "POST")
    return reorder(id, user, data);
  else if (
    root === "days" &&
    action === "routes" &&
    subId === "recalculate" &&
    method === "POST"
  )
    return calculateDay(
      id,
      user,
      z.object({ force: z.boolean().optional() }).parse(data).force,
    );
  else if (root === "items" && action === "move" && method === "POST")
    return moveItem(id, user, data);
  else if (root === "items" && id && !action) {
    if (method === "PATCH") return editItem(id, user, data);
    if (method === "DELETE") return deleteItem(id, user, expectedVersion(data));
  } else if (root === "legs" && method === "PATCH" && !action)
    return editLeg(id, user, data);
  else if (root === "legs" && method === "POST" && action === "route") {
    await calculateLeg(id, user, true);
    const leg = requireValue(
      one<Leg>("SELECT * FROM travel_legs WHERE id=?", id),
    );
    return requireValue(getDay(leg.dayId).legs.find((item) => item.id === id));
  } else if (root === "routes" && method === "POST")
    return {
      alternatives: (await amap.routes(routeRequestSchema.parse(data))).map(
        (alternative, index) => ({
          ...alternative,
          id: uid(),
          label: `方案 ${index + 1}`,
          fetchedAt: Date.now(),
        }),
      ),
    };
  else if (root === "places" && method === "GET") {
    if (["search", "autocomplete"].includes(id)) {
      const query = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .parse(url.searchParams.get("q"));
      const city = z
        .string()
        .max(100)
        .parse(url.searchParams.get("city") ?? "");
      return {
        places: await amap[id === "search" ? "search" : "autocomplete"](
          query,
          city,
        ),
      };
    }
    return amap.details(
      z
        .string()
        .regex(/^[A-Za-z0-9]{1,64}$/)
        .parse(id),
    );
  }
  return UNHANDLED;
};
