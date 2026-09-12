import { z } from "zod";
import * as s from "@/server/service";
import { actor, body, sameOrigin } from "@/server/http";
import { AppError, requireValue } from "@/server/errors";
import { one } from "@/server/db";
import { amap } from "@/amap/service";
import { routeRequestSchema } from "@/amap/requests";
import { calculateDay, calculateLeg } from "@/server/routing";
import type { Expense, Leg } from "@/domain/types";
import { events } from "@/server/events";
import {
  listMcpTokens,
  createMcpToken,
  revokeMcpToken,
} from "@/server/mcp-tokens";
import {
  savePoolPlace,
  deletePoolPlace,
  schedulePlace,
  moveItem,
  reorderPoolPlaces,
} from "@/server/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context): Promise<Response> {
  const started = performance.now(),
    requestId = crypto.randomUUID();
  let status = 200,
    endpoint = "unknown";
  try {
    const { path } = await context.params;
    endpoint = path[0];
    const [root, id, action, subId] = path,
      method = request.method,
      url = new URL(request.url);
    if (root === "health" && method === "GET")
      return Response.json({ ok: true });
    const user = await actor(request);
    if (method !== "GET") sameOrigin(request);
    if (root === "config" && method === "GET")
      return Response.json({
        amapJsKey: process.env.AMAP_JS_KEY || "",
        mapAvailable: !!(
          process.env.AMAP_JS_KEY && process.env.AMAP_SECURITY_CODE
        ),
        testMode: process.env.AMAP_TEST_MODE === "1",
      });
    if (root === "trips" && action === "events" && method === "GET")
      return events(id, user, request);
    const data = method === "GET" ? undefined : await body(request);
    const expected = () =>
      z.object({ expectedVersion: z.number().int().positive() }).parse(data)
        .expectedVersion;
    let result: unknown;
    if (root === "mcp-tokens" && !action) {
      if (method === "GET" && !id) result = listMcpTokens(user);
      else if (method === "POST" && !id) result = createMcpToken(user, data);
      else if (method === "DELETE" && id) result = revokeMcpToken(user, id);
    } else if (root === "trips" && !id) {
      if (method === "GET") result = s.listTrips(user);
      else if (method === "POST") result = s.createTrip(user, data);
    } else if (root === "trips" && id && !action) {
      if (method === "GET") result = s.snapshot(id, user);
      else if (method === "PATCH") result = s.editTrip(id, user, data);
      else if (method === "DELETE") result = s.deleteTrip(id, user, expected());
    } else if (root === "trips" && action === "days" && method === "POST") {
      if (subId === "reorder") result = s.reorderDays(id, user, data);
      else {
        s.access(id, user, "edit");
        throw new AppError(
          405,
          "CALENDAR_MANAGED",
          "请在行程设置中调整天数或日期范围",
        );
      }
    } else if (root === "trips" && action === "places") {
      if (method === "GET" && !subId) result = s.snapshot(id, user).poolPlaces;
      else if (method === "POST" && !subId)
        result = savePoolPlace(id, user, data);
      else if (method === "POST" && subId === "reorder" && path.length === 4)
        result = reorderPoolPlaces(id, user, data);
      else if (method === "PATCH" && subId)
        result = savePoolPlace(id, user, data, subId);
      else if (method === "DELETE" && subId)
        result = deletePoolPlace(id, subId, user, expected());
      else if (method === "POST" && subId && path[4] === "schedule")
        result = schedulePlace(id, subId, user, data);
    } else if (root === "trips" && action === "participants") {
      if (method === "GET") result = s.snapshot(id, user).participants;
      else if (method === "POST" && !subId)
        result = s.createParticipant(id, user, data);
      else if (method === "PATCH" && subId)
        result = s.editParticipant(id, subId, user, data);
    } else if (root === "trips" && action === "members") {
      if (method === "GET") result = s.snapshot(id, user).members;
      else if (method === "PATCH" && subId)
        result = s.editMember(id, subId, user, data);
    } else if (root === "trips" && action === "invites") {
      if (method === "GET") {
        s.access(id, user, "owner");
        result = s.snapshot(id, user).invites;
      } else if (method === "POST" && !subId)
        result = s.createInvite(id, user, data);
      else if (method === "DELETE" && subId)
        result = s.revokeInvite(id, subId, user, expected());
    } else if (root === "invites" && action === "join" && method === "POST")
      result = s.joinInvite(id, user);
    else if (root === "days" && id && !action) {
      if (method === "GET") {
        const d = s.getDay(id);
        s.access(d.tripId, user);
        result = d;
      } else if (method === "PATCH") result = s.editDay(id, user, data);
      else if (method === "DELETE") {
        s.access(s.getDay(id).tripId, user, "edit");
        throw new AppError(
          405,
          "CALENDAR_MANAGED",
          "请在行程设置中调整天数或日期范围",
        );
      }
    } else if (root === "days" && action === "items" && method === "POST")
      result = s.createItem(id, user, data);
    else if (root === "days" && action === "reorder" && method === "POST")
      result = s.reorder(id, user, data);
    else if (
      root === "days" &&
      action === "routes" &&
      subId === "recalculate" &&
      method === "POST"
    )
      result = await calculateDay(
        id,
        user,
        z.object({ force: z.boolean().optional() }).parse(data).force,
      );
    else if (root === "items" && action === "move" && method === "POST")
      result = moveItem(id, user, data);
    else if (root === "items" && id && !action) {
      if (method === "PATCH") result = s.editItem(id, user, data);
      else if (method === "DELETE") result = s.deleteItem(id, user, expected());
    } else if (root === "legs" && method === "PATCH" && !action)
      result = s.editLeg(id, user, data);
    else if (root === "legs" && method === "POST" && action === "route") {
      await calculateLeg(id, user, true);
      const leg = requireValue(
        one<Leg>("SELECT * FROM travel_legs WHERE id=?", id),
      );
      result = requireValue(s.getDay(leg.dayId).legs.find((l) => l.id === id));
    } else if (root === "routes" && method === "POST")
      result = {
        alternatives: (await amap.routes(routeRequestSchema.parse(data))).map(
          (a, index) => ({
            ...a,
            id: s.uid(),
            label: `方案 ${index + 1}`,
            fetchedAt: Date.now(),
          }),
        ),
      };
    else if (root === "places" && method === "GET") {
      if (["search", "autocomplete"].includes(id)) {
        const q = z
          .string()
          .trim()
          .min(1)
          .max(100)
          .parse(url.searchParams.get("q"));
        const city = z
          .string()
          .max(100)
          .parse(url.searchParams.get("city") ?? "");
        result = {
          places: await amap[id === "search" ? "search" : "autocomplete"](
            q,
            city,
          ),
        };
      } else
        result = await amap.details(
          z
            .string()
            .regex(/^[A-Za-z0-9]{1,64}$/)
            .parse(id),
        );
    } else if (root === "trips" && action === "expenses") {
      if (method === "GET") result = s.snapshot(id, user).expenses;
      else if (method === "POST") result = s.saveExpense(id, user, data);
    } else if (root === "expenses" && !action) {
      if (method === "PATCH") {
        const e = requireValue(
          one<Expense>("SELECT * FROM expenses WHERE id=?", id),
        );
        result = s.saveExpense(e.tripId, user, data, id);
      } else if (method === "DELETE")
        result = s.deleteExpense(id, user, expected());
    } else if (root === "trips" && action === "balances" && method === "GET")
      result = s.balances(id, user);
    else if (root === "trips" && action === "settlements" && method === "POST")
      result = s.createSettlement(id, user, data);
    else if (root === "settlements" && method === "DELETE")
      result = s.deleteSettlement(id, user, expected());
    else if (root === "trips" && action === "activity" && method === "GET")
      result = s.snapshot(id, user).activity;
    else if (root === "trips" && action === "comments") {
      if (method === "GET") result = s.snapshot(id, user).comments;
      else if (method === "POST") result = s.addComment(id, user, data);
    }
    if (result === undefined)
      throw new AppError(404, "NOT_FOUND", "接口不存在");
    return Response.json(result, {
      headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}：${i.message}`)
              .join("；")
          : "服务暂时不可用，请稍后重试";
    if (status === 500)
      console.error({
        requestId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    return Response.json(
      {
        error: {
          code:
            error instanceof AppError
              ? error.code
              : status === 400
                ? "VALIDATION"
                : "INTERNAL",
          message,
        },
        requestId,
      },
      { status },
    );
  } finally {
    console.info(
      JSON.stringify({
        requestId,
        endpoint,
        operation: request.method,
        duration: Math.round(performance.now() - started),
        status,
      }),
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
