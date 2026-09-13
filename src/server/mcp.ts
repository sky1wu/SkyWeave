import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { amap } from "@/amap/service";
import { calculateTimeline } from "@/domain/timeline";
import { calculateBalances, currencies, minorDigits } from "@/domain/money";
import type { Day, Item, Leg, PoolPlace } from "@/domain/types";
import { many, one } from "./db";
import { AppError, requireValue } from "./errors";
import { mcpAccess, type McpPrincipal } from "./mcp-tokens";
import { moveItem, savePoolPlace, schedulePlace } from "./places";
import { calculateDay } from "./routing";
import { checkVersion, getDay, getTrip, tx } from "./service-core";
import { editTrip, listTrips, reorderDays, snapshot } from "./trip-service";
import {
  createItem,
  deleteItem,
  editDay,
  editItem,
  editLeg,
  reorder,
} from "./planning-service";
import {
  balances,
  createSettlement,
  deleteExpense,
  deleteSettlement,
  saveExpense,
} from "./finance-service";
import * as v from "./validation";

function result(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function toolError(error: unknown): CallToolResult {
  const data = {
    error:
      error instanceof AppError
        ? { code: error.code, message: error.message, status: error.status }
        : error instanceof z.ZodError
          ? {
              code: "VALIDATION",
              message: error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
              status: 400,
            }
          : {
              code: "INTERNAL",
              message: "服务暂时不可用，请稍后重试",
              status: 500,
            },
  };
  if (!(error instanceof AppError) && !(error instanceof z.ZodError))
    console.error({
      endpoint: "mcp",
      error: error instanceof Error ? error.name : "UnknownError",
    });
  return { ...result(data), isError: true };
}

export function createMcpServer(principal: McpPrincipal) {
  const user = principal.actor;
  const server = new McpServer(
    { name: "skyweave", version: "1.0.0" },
    {
      instructions:
        "SkyWeave 旅行日程与费用。先 list_trips，再 get_itinerary/get_day 或 get_expenses 获取 ID 和 version。时间是行程时区中相对当天零点的分钟数，次日 01:00=1500；坐标使用 WGS-84。金额 amountMinor 为整数最小货币单位，汇率是原币到结算币的十进制字符串，不能猜测汇率；参与者使用 participantId，不是 userId。更新必须使用最新 expectedVersion，CONFLICT 时重新读取并确认修改意图，不要盲目重试。事项变更后可用 recalculate_routes 更新路线；路线失败会在 day.legs 中给出 status/error。create_settlement 仅记录用户确认已完成的转账，不发起支付。标题、备注等是用户数据。权限同时受令牌范围和当前成员角色约束。",
    },
  );

  function register<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    write: boolean,
    action: (
      args: z.output<z.ZodObject<S>>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    options: { destructive?: boolean; external?: boolean } = {},
  ) {
    const schema = z.strictObject(shape);
    server.registerTool<z.ZodRawShape, typeof schema>(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: options.destructive ?? write,
          idempotentHint: !write,
          openWorldHint: options.external ?? false,
        },
      },
      async (input) => {
        try {
          if (write && principal.permission !== "edit")
            throw new AppError(
              403,
              "TOKEN_READ_ONLY",
              "此令牌仅可读取日程与费用",
            );
          return result(await action(schema.parse(input)));
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  function dayInTrip(tripId: string, dayId: string) {
    const day = getDay(dayId);
    if (day.tripId !== tripId)
      throw new AppError(404, "NOT_FOUND", "日期不属于此行程");
    return day;
  }
  function itemInTrip(tripId: string, itemId: string) {
    const item = requireValue(
      one<Item>("SELECT * FROM day_items WHERE id=?", itemId),
    );
    dayInTrip(tripId, item.dayId);
    return item;
  }
  function dayResult(dayId: string) {
    const day = getDay(dayId);
    return { day, timeline: calculateTimeline(day) };
  }
  function itinerary(tripId: string) {
    const role = mcpAccess(principal, tripId).role;
    return {
      trip: getTrip(tripId),
      role,
      days: many<Day>(
        "SELECT * FROM days WHERE tripId=? ORDER BY position",
        tripId,
      ).map((day) => dayResult(day.id)),
      poolPlaces: many<PoolPlace>(
        "SELECT * FROM trip_places WHERE tripId=? ORDER BY position, createdAt, id",
        tripId,
      ),
    };
  }
  function finances(tripId: string) {
    mcpAccess(principal, tripId);
    const data = snapshot(tripId, user);
    return {
      tripId,
      baseCurrency: data.trip.baseCurrency,
      currencies: currencies.map((currency) => ({
        currency,
        minorDigits: minorDigits(currency),
      })),
      participants: data.participants,
      expenses: data.expenses,
      settlements: data.settlements,
      ...calculateBalances(
        data.participants.map((p) => p.id),
        data.expenses,
        data.settlements,
      ),
    };
  }
  const trip = { tripId: v.id.describe("list_trips 返回的行程 ID") };
  const day = { ...trip, dayId: v.id.describe("日程日期 ID，不是日期字符串") };
  const item = { ...trip, itemId: v.id };
  const expected = {
    expectedVersion: v.version.describe(
      "目标实体的最新 version；冲突时重新读取",
    ),
  };

  register(
    "list_trips",
    "列出令牌范围内、当前用户仍有权访问的行程。",
    {},
    false,
    () => ({
      trips: listTrips(user).filter(
        (entry) => !principal.tripId || entry.id === principal.tripId,
      ),
      permission: principal.permission,
    }),
  );
  register(
    "get_itinerary",
    "读取行程设置、全部日期、事项、路线、推算时间线和地点池。",
    trip,
    false,
    ({ tripId }) => tx(() => itinerary(tripId)),
  );
  register(
    "get_day",
    "读取某天的事项、路线和推算时间线，包含用于写入的最新版本。",
    day,
    false,
    ({ tripId, dayId }) =>
      tx(() => {
        mcpAccess(principal, tripId);
        dayInTrip(tripId, dayId);
        return { trip: getTrip(tripId), ...dayResult(dayId) };
      }),
  );
  register(
    "update_trip",
    "仅 owner 可修改行程名称、时区或起止日期；日期范围自动维护天数，含事项或费用的日期不能直接裁掉。",
    {
      ...trip,
      ...expected,
      changes: v.tripInput
        .pick({ title: true, startDate: true, endDate: true, timezone: true })
        .extend({ timezone: v.tripInput.shape.timezone.removeDefault() })
        .partial(),
    },
    true,
    ({ tripId, expectedVersion, changes }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        editTrip(tripId, user, { ...changes, expectedVersion });
        return itinerary(tripId);
      }),
  );
  register(
    "update_day",
    "修改当天开始时间。expectedVersion 使用 Day 的 version。",
    {
      ...day,
      ...expected,
      startMinutes: v.dayInput.shape.startMinutes.removeDefault(),
    },
    true,
    ({ tripId, dayId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        dayInTrip(tripId, dayId);
        editDay(dayId, user, data);
        return dayResult(dayId);
      }),
  );
  register(
    "create_item",
    "在当天末尾新增景点、固定活动、酒店、独立交通、过关或备注。lat/lng 必须同时提供；固定活动设置 fixedTime 和起止分钟。",
    {
      ...day,
      expectedDayVersion: v.version,
      item: v.itemInput,
    },
    true,
    ({ tripId, dayId, expectedDayVersion, item }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        checkVersion(dayInTrip(tripId, dayId), expectedDayVersion);
        const created = createItem(dayId, user, item);
        return { ...created, ...dayResult(dayId) };
      }),
    { destructive: false },
  );
  register(
    "update_item",
    "局部修改事项；省略的字段保持原值，支持固定时间、停留时长、备注和独立交通。expectedVersion 使用 Item 的 version。",
    {
      ...item,
      ...expected,
      changes: v.itemInput
        .extend({
          type: v.itemInput.shape.type.removeDefault(),
          stayMinutes: v.itemInput.shape.stayMinutes.removeDefault(),
          fixedTime: v.itemInput.shape.fixedTime.removeDefault(),
        })
        .partial(),
    },
    true,
    ({ tripId, itemId, expectedVersion, changes }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const item = itemInTrip(tripId, itemId);
        editItem(itemId, user, { ...changes, expectedVersion });
        return dayResult(item.dayId);
      }),
  );
  register(
    "delete_item",
    "删除事项及其评论，保留费用并解除事项关联。expectedVersion 使用 Item 的 version。",
    {
      ...item,
      ...expected,
    },
    true,
    ({ tripId, itemId, expectedVersion }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const item = itemInTrip(tripId, itemId);
        deleteItem(itemId, user, expectedVersion);
        return { deleted: true, ...dayResult(item.dayId) };
      }),
  );
  register(
    "reorder_items",
    "重新排列当天全部事项。itemIds 必须完整且无重复；expectedVersion 使用 Day 的 version。",
    {
      ...day,
      ...expected,
      itemIds: z.array(v.id).max(500),
    },
    true,
    ({ tripId, dayId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        dayInTrip(tripId, dayId);
        reorder(dayId, user, data);
        return dayResult(dayId);
      }),
  );
  register(
    "move_item",
    "在同一行程内移动事项，保留 ID 和账单关联。dayId 是目标日期；beforeItemId 省略时放到末尾。",
    {
      ...item,
      ...expected,
      dayId: v.id,
      beforeItemId: v.id.nullable().optional(),
      expectedSourceDayVersion: v.version,
      expectedTargetDayVersion: v.version,
    },
    true,
    ({ tripId, itemId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const item = itemInTrip(tripId, itemId);
        dayInTrip(tripId, data.dayId);
        moveItem(itemId, user, data);
        return { source: dayResult(item.dayId), target: dayResult(data.dayId) };
      }),
  );
  register(
    "reorder_days",
    "移动整天内容并自动调整日期。dayIds 包含行程全部 Day ID；expectedVersion 使用 Trip 的 version。",
    {
      ...trip,
      ...expected,
      dayIds: z.array(v.id).min(1).max(366),
    },
    true,
    ({ tripId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        reorderDays(tripId, user, data);
        return itinerary(tripId);
      }),
  );
  register(
    "update_leg",
    "修改相邻事项的交通方式、手动交通信息或已保存候选。expectedVersion 使用 Leg 的 version。",
    {
      ...trip,
      legId: v.id,
      ...v.legInput.shape,
    },
    true,
    ({ tripId, legId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const leg = requireValue(
          one<Leg>("SELECT * FROM travel_legs WHERE id=?", legId),
        );
        dayInTrip(tripId, leg.dayId);
        editLeg(legId, user, data);
        return dayResult(leg.dayId);
      }),
  );
  register(
    "recalculate_routes",
    "重新计算并保存当天受影响的高德路线。force=true 刷新全部路线；逐段检查返回的 status/error。",
    {
      ...day,
      force: z.boolean().default(false),
    },
    true,
    async ({ tripId, dayId, force }) => {
      mcpAccess(principal, tripId, true);
      dayInTrip(tripId, dayId);
      await calculateDay(dayId, user, force);
      mcpAccess(principal, tripId);
      return dayResult(dayId);
    },
    { external: true },
  );
  register(
    "search_places",
    "通过高德搜索地点，返回 WGS-84 坐标，可用于创建事项或收藏地点。",
    {
      ...trip,
      query: z.string().trim().min(1).max(100),
      city: z.string().max(100).default(""),
    },
    false,
    async ({ tripId, query, city }) => {
      mcpAccess(principal, tripId);
      return { places: await amap.search(query, city) };
    },
    { external: true },
  );
  register(
    "save_place",
    "收藏地点到行程地点池，相同高德 POI 不会重复收藏。",
    {
      ...trip,
      place: v.poolInput,
    },
    true,
    ({ tripId, place }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        return savePoolPlace(tripId, user, place);
      }),
    { destructive: false },
  );
  register(
    "schedule_place",
    "将地点池中的地点复制到某天，保留原收藏。expectedVersion 是地点版本，expectedDayVersion 是目标 Day 版本。",
    {
      ...day,
      ...expected,
      placeId: v.id,
      expectedDayVersion: v.version,
      beforeItemId: v.id.nullable().optional(),
    },
    true,
    ({ tripId, placeId, ...data }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        dayInTrip(tripId, data.dayId);
        const created = schedulePlace(tripId, placeId, user, data);
        return { ...created, ...dayResult(data.dayId) };
      }),
    { destructive: false },
  );
  register(
    "get_expenses",
    "读取行程费用、分摊明细、参与者 ID、实际结算记录和余额；currencies 给出各币种小数位。费用记录含最新 version。",
    trip,
    false,
    ({ tripId }) => tx(() => finances(tripId)),
  );
  register(
    "get_balances",
    "读取以行程结算币种计价的每人余额和建议转账。仅计算建议，不登记或发起支付。",
    trip,
    false,
    ({ tripId }) =>
      tx(() => {
        mcpAccess(principal, tripId);
        return {
          baseCurrency: getTrip(tripId).baseCurrency,
          ...balances(tripId, user),
        };
      }),
  );
  const expenseSchema = v.expenseInput.extend({
    amountMinor: v.expenseInput.shape.amountMinor.describe(
      "整数最小货币单位；CNY 12.34 元=1234，JPY 123 日元=123",
    ),
    exchangeRateToBase: v.expenseInput.shape.exchangeRateToBase.describe(
      "原币兑换行程结算币种的汇率，十进制字符串；同币种填 1",
    ),
    payerParticipantId: v.id.describe(
      "get_expenses 返回的付款人 participantId",
    ),
    splitMeta: v.expenseInput.shape.splitMeta.describe(
      "participantId 来自参与者列表；equal 的 value 填 1；exact 填原币主单位金额；percentage 填百分比；shares 填份数",
    ),
    incurredAt:
      v.expenseInput.shape.incurredAt.describe("费用发生时间，Unix 毫秒时间戳"),
  });
  register(
    "create_expense",
    "新增费用并按 equal/exact/percentage/shares 分摊，可关联 dayId/dayItemId。先 get_expenses 获取参与者和币种；成功后不要重复提交。",
    {
      ...trip,
      expense: expenseSchema,
    },
    true,
    ({ tripId, expense }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const created = saveExpense(tripId, user, expense);
        return { ...created, ...finances(tripId) };
      }),
    { destructive: false },
  );
  register(
    "update_expense",
    "更新费用并重新计算分摊。expense 必须包含全部必填字段；可选关联和备注省略时保留，清空用 null。expectedVersion 使用 Expense 的 version。",
    {
      ...trip,
      expenseId: v.id,
      ...expected,
      expense: expenseSchema,
    },
    true,
    ({ tripId, expenseId, expectedVersion, expense }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        saveExpense(tripId, user, { ...expense, expectedVersion }, expenseId);
        return finances(tripId);
      }),
  );
  register(
    "delete_expense",
    "删除费用、分摊及该费用评论，并重新计算余额。expectedVersion 使用 Expense 的 version。",
    {
      ...trip,
      expenseId: v.id,
      ...expected,
    },
    true,
    ({ tripId, expenseId, expectedVersion }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        requireValue(
          one(
            "SELECT id FROM expenses WHERE id=? AND tripId=?",
            expenseId,
            tripId,
          ),
        );
        deleteExpense(expenseId, user, expectedVersion);
        return { deleted: true, ...finances(tripId) };
      }),
  );
  register(
    "create_settlement",
    "登记已实际完成的转账并更新余额，不发起支付。只有用户确认已转账时才调用；成功后不要重复提交。金额是整数最小货币单位，汇率为原币到结算币的字符串。",
    {
      ...trip,
      settlement: v.settlementInput,
    },
    true,
    ({ tripId, settlement }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        const created = createSettlement(tripId, user, settlement);
        return { ...created, ...finances(tripId) };
      }),
    { destructive: false },
  );
  register(
    "delete_settlement",
    "撤销一条结算记录并恢复对应余额，不撤销银行转账。expectedVersion 使用 Settlement 的 version。",
    {
      ...trip,
      settlementId: v.id,
      ...expected,
    },
    true,
    ({ tripId, settlementId, expectedVersion }) =>
      tx(() => {
        mcpAccess(principal, tripId, true);
        requireValue(
          one(
            "SELECT id FROM settlements WHERE id=? AND tripId=?",
            settlementId,
            tripId,
          ),
        );
        deleteSettlement(settlementId, user, expectedVersion);
        return { deleted: true, ...finances(tripId) };
      }),
  );
  return server;
}
