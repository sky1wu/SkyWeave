import { z } from "zod";
import { tripDates } from "@/domain/calendar";
import { calculateBalances, convertMoney, splitExpense } from "@/domain/money";
import { TRIP_FILE_FORMAT, TRIP_FILE_VERSION } from "@/domain/trip-file";
import { AppError } from "./errors";
import * as v from "./validation";

const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(4000);
export const fileTrip = v.tripInput.strip().extend({
  startDate: v.date.nullable(),
  endDate: v.date.nullable(),
  baseCurrencyLocked: z.boolean(),
});
export const filePlace = v.poolInput.strip().extend({ id: v.id });
export const fileItem = v.itemInput.strip().extend({ id: v.id });
export const fileAlternative = z.object({
  id: v.id,
  provider: z.string().max(100),
  fingerprint: text,
  label: text,
  distanceMeters: nonnegative,
  durationSeconds: nonnegative,
  walkingDistanceMeters: nonnegative.nullable(),
  transferCount: nonnegative.nullable(),
  polyline: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .max(500000),
  steps: z
    .array(
      z.object({
        mode: z.string().max(100),
        instruction: text,
        distanceMeters: z.number().finite().min(0).optional(),
        durationSeconds: z.number().finite().min(0).optional(),
      }),
    )
    .max(10000),
  summary: text,
  geometryComplete: z.boolean(),
  fetchedAt: nonnegative,
});
export const fileLeg = v.legInput
  .omit({ expectedVersion: true })
  .strip()
  .extend({
    id: v.id,
    fromItemId: v.id,
    toItemId: v.id,
    mode: v.legInput.shape.mode.unwrap(),
    provider: z.string().max(100),
    selectedAlternativeId: v.id.nullable(),
    selectionSource: z.string().max(100),
    status: z.enum(["pending", "ready", "error"]),
    error: text.nullable(),
    requestKey: text.nullable(),
    alternatives: z.array(fileAlternative).max(100),
  });
export const fileDay = v.dayInput.strip().extend({
  id: v.id,
  title: z.string().min(1).max(200),
  date: v.date.nullable(),
  items: z.array(fileItem).max(10000),
  legs: z.array(fileLeg).max(10000),
});
export const fileParticipant = z.object({
  id: v.id,
  name: z.string().min(1).max(200),
  status: z.enum(["active", "inactive"]),
});
export const fileExpense = v.expenseInput.strip().extend({
  id: v.id,
  baseAmountMinor: nonnegative,
  splits: z
    .array(
      z.object({
        participantId: v.id,
        amountMinor: nonnegative,
        baseAmountMinor: nonnegative,
      }),
    )
    .min(1)
    .max(100),
});
export const fileSettlement = v.settlementInput.strip().extend({
  id: v.id,
  baseAmountMinor: nonnegative,
});
export const tripFileSchema = z.object({
  format: z.literal(TRIP_FILE_FORMAT),
  version: z.literal(TRIP_FILE_VERSION),
  exportedAt: z.iso.datetime(),
  trip: fileTrip,
  days: z.array(fileDay).max(366),
  poolPlaces: z.array(filePlace).max(10000),
  participants: z.array(fileParticipant).max(10000),
  expenses: z.array(fileExpense).max(10000),
  settlements: z.array(fileSettlement).max(10000),
});
export type TripFile = z.infer<typeof tripFileSchema>;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError(400, "INVALID_TRIP_FILE", message);
}

// Validate the entire graph before starting a write, including references that
// SQLite cannot enforce (transport endpoints, route selection and split metadata).
export function parseTripFile(body: unknown): TripFile {
  if (
    body &&
    typeof body === "object" &&
    "format" in body &&
    body.format === TRIP_FILE_FORMAT &&
    "version" in body
  ) {
    ensure(
      body.version === TRIP_FILE_VERSION,
      "暂不支持此行程文件版本，请使用当前版本导出的文件",
    );
  }
  const parsed = tripFileSchema.safeParse(body);
  ensure(
    parsed.success,
    "行程文件格式或字段无效，请选择 SkyWeave 导出的 JSON 文件",
  );
  const file = parsed.data;
  const ids = new Set<string>();
  const collect = (rows: { id: string }[]) => {
    for (const row of rows) {
      ensure(!ids.has(row.id), "行程文件中存在重复标识");
      ids.add(row.id);
    }
    return new Set(rows.map((row) => row.id));
  };
  const dayIds = collect(file.days);
  const placeIds = collect(file.poolPlaces);
  const people = collect(file.participants);
  collect(file.expenses);
  collect(file.settlements);
  const itemDays = new Map<string, string>();
  const reference = (id: string | null | undefined, allowed: Set<string>) =>
    ensure(
      id == null || allowed.has(id),
      "行程文件中的关联数据缺失或不属于此行程",
    );
  const coordinates = (point: { lat?: number | null; lng?: number | null }) =>
    ensure((point.lat == null) === (point.lng == null), "经纬度必须成对填写");
  const pois = new Set<string>();
  for (const place of file.poolPlaces) {
    coordinates(place);
    if (place.amapPoiId) {
      ensure(!pois.has(place.amapPoiId), "地点池中存在重复的高德地点");
      pois.add(place.amapPoiId);
    }
  }
  const { startDate, endDate } = file.trip;
  ensure((startDate === null) === (endDate === null), "行程起止日期不完整");
  if (startDate && endDate) {
    let dates: string[];
    try {
      dates = tripDates(startDate, endDate);
    } catch {
      throw new AppError(400, "INVALID_TRIP_FILE", "行程日期范围无效");
    }
    ensure(
      dates.length === file.days.length &&
        file.days.every((day, i) => day.date === dates[i]),
      "每日日期与行程日期范围不一致",
    );
  }
  for (const day of file.days) {
    const items = collect(day.items);
    collect(day.legs);
    for (const item of day.items) {
      itemDays.set(item.id, day.id);
      coordinates(item);
      reference(item.sourcePlaceId, placeIds);
      ensure(
        !item.fixedTime || item.startMinutes != null,
        "固定活动必须设置开始时间",
      );
      ensure(
        item.endMinutes == null ||
          (item.startMinutes == null
            ? !!item.transport
            : item.endMinutes >= item.startMinutes),
        "事项开始和结束时间无效",
      );
      if (item.transport) {
        ensure(item.type === "transport", "独立交通必须使用交通类型");
        reference(item.transport.origin.sourcePlaceId, placeIds);
        reference(item.transport.destination.sourcePlaceId, placeIds);
      }
    }
    const pairs = new Set<string>();
    for (const leg of day.legs) {
      reference(leg.fromItemId, items);
      reference(leg.toItemId, items);
      const pair = JSON.stringify([leg.fromItemId, leg.toItemId]);
      ensure(
        leg.fromItemId !== leg.toItemId && !pairs.has(pair),
        "交通路线起终点无效或重复",
      );
      pairs.add(pair);
      reference(leg.selectedAlternativeId, collect(leg.alternatives));
    }
  }
  try {
    const totals = new Map<string, bigint>();
    for (const expense of file.expenses) {
      reference(expense.dayId, dayIds);
      if (expense.dayItemId)
        ensure(
          itemDays.has(expense.dayItemId) &&
            (!expense.dayId ||
              expense.dayId === itemDays.get(expense.dayItemId)),
          "费用关联的事项与日期不一致",
        );
      reference(expense.payerParticipantId, people);
      expense.splitMeta.forEach((split) =>
        reference(split.participantId, people),
      );
      ensure(
        expense.baseAmountMinor ===
          convertMoney(
            expense.amountMinor,
            expense.currency,
            file.trip.baseCurrency,
            expense.exchangeRateToBase,
          ),
        "费用换算金额不一致",
      );
      const expected = splitExpense(
        expense.amountMinor,
        expense.baseAmountMinor,
        expense.currency,
        expense.splitMethod,
        expense.splitMeta,
      );
      const splits = new Map(
        expense.splits.map((split) => [split.participantId, split]),
      );
      ensure(
        splits.size === expense.splits.length &&
          splits.size === expected.length &&
          expected.every((split) => {
            const actual = splits.get(split.participantId);
            return (
              actual?.amountMinor === split.amountMinor &&
              actual.baseAmountMinor === split.baseAmountMinor
            );
          }),
        "费用分摊金额不一致",
      );
      const total =
        (totals.get(expense.currency) ?? 0n) + BigInt(expense.amountMinor);
      ensure(
        total <= BigInt(Number.MAX_SAFE_INTEGER),
        "费用累计金额超出可安全计算范围",
      );
      totals.set(expense.currency, total);
    }
    for (const settlement of file.settlements) {
      reference(settlement.fromParticipantId, people);
      reference(settlement.toParticipantId, people);
      ensure(
        settlement.fromParticipantId !== settlement.toParticipantId,
        "转出人与收款人不能相同",
      );
      ensure(
        settlement.baseAmountMinor ===
          convertMoney(
            settlement.amountMinor,
            settlement.currency,
            file.trip.baseCurrency,
            settlement.exchangeRateToBase,
          ),
        "结算换算金额不一致",
      );
    }
    calculateBalances([...people], file.expenses, file.settlements);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "INVALID_TRIP_FILE",
      `行程费用数据无效：${(error as Error).message}`,
    );
  }
  return file;
}
