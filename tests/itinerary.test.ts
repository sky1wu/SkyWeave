import { expect, it } from "vitest";
import { itineraryDate, itineraryDays } from "@/domain/itinerary";
import {
  itineraryFilename,
  posterArchive,
  wrapPosterText,
} from "@/lib/itinerary-poster";
import type { DayPlan, Item } from "@/domain/types";

const rev = { version: 1, createdAt: 0, updatedAt: 0, updatedByUserId: "u" };
const item = (
  id: string,
  position: number,
  values: Partial<Item> = {},
): Item => ({
  id,
  dayId: "d",
  title: id,
  position,
  type: "place",
  sourcePlaceId: null,
  placeCategory: "未分类",
  description: null,
  notes: null,
  address: null,
  amapPoiId: null,
  lat: 22,
  lng: 114,
  startMinutes: null,
  endMinutes: null,
  stayMinutes: 0,
  transport: null,
  fixedTime: false,
  ...rev,
  ...values,
});
const day = (items: Item[], values: Partial<DayPlan> = {}): DayPlan => ({
  id: "d",
  tripId: "t",
  title: "第 1 天",
  date: "2026-10-02",
  position: 0,
  startMinutes: 480,
  items,
  legs: [],
  ...rev,
  ...values,
});

it("keeps fixed appointments distinct from a late estimate, with connections across notes", () => {
  const plan = day(
    [
      item("约好的午餐", 2, {
        fixedTime: true,
        startMinutes: 540,
        endMinutes: 600,
      }),
      item("带上相机", 1, { type: "note", notes: "电池充满" }),
      item("出发", 0, { stayMinutes: 90 }),
    ],
    {
      legs: [
        {
          id: "leg",
          dayId: "d",
          fromItemId: "出发",
          toItemId: "约好的午餐",
          mode: "manual",
          provider: "manual",
          selectedAlternativeId: null,
          selectionSource: "manual",
          manualDurationMinutes: 15,
          manualDistanceMeters: 500,
          manualDescription: "沿河步行",
          status: "ready",
          error: null,
          requestKey: null,
          alternatives: [],
          ...rev,
        },
      ],
    },
  );
  const result = itineraryDays([plan])[0];
  expect(result.stops.map((stop) => stop.title)).toEqual([
    "出发",
    "带上相机",
    "约好的午餐",
  ]);
  expect(result.stops[1].connection).toBeNull();
  expect(result.stops[2].time).toBe("09:00 – 10:00");
  expect(result.stops[2].warnings).toContain("预计迟到 45 分钟");
  expect(result.stops[2].details).toContainEqual({
    kind: "info",
    text: "预计 09:45 到达",
  });
  expect(result.stops[2].connection).toMatchObject({
    summary: "接驳交通 · 15 分钟 · 500 米",
    description: "沿河步行",
  });
  expect(plan.items[0].title).toBe("约好的午餐");
});

it("preserves overnight service details and does not invent times for an unknown route", () => {
  const result = itineraryDays([
    day([
      item("夜间列车", 0, {
        type: "transport",
        startMinutes: 1410,
        endMinutes: 1530,
        transport: {
          mode: "train",
          status: "tentative",
          serviceNumber: "D123",
          durationMinutes: null,
          origin: {
            name: "上海站",
            address: "出发地址",
            sourcePlaceId: null,
            amapPoiId: null,
            lat: 31,
            lng: 121,
          },
          destination: {
            name: "杭州站",
            address: "到达地址",
            sourcePlaceId: null,
            amapPoiId: null,
            lat: 30,
            lng: 120,
          },
        },
      }),
      item("入住", 1),
    ]),
  ])[0];
  expect(result.stops[0]).toMatchObject({
    time: "23:30 – 次日 01:30",
    category: "火车 D123",
    timing: "班次待确认",
  });
  expect(result.stops[0].details).toContainEqual({
    kind: "info",
    text: "上海站 → 杭州站",
  });
  expect(
    result.stops[0].details.map((detail) => detail.text).join(),
  ).not.toMatch(/预计|提前|到达时间待定/);
  expect(result.stops[0].warnings).toEqual([]);
  expect(result.stops[1].time).toBe("时间待定");
  expect(result.stops[1].connection?.summary).toBe("交通待规划");
});

it("omits first-stop arrival estimates on every day and retains unknown arrivals for later stops", () => {
  const days = [0, 1].map((position) =>
    day(
      [
        item("first", 0, { fixedTime: true, startMinutes: 540 }),
        item("next", 1, { fixedTime: true, startMinutes: 600 }),
      ],
      { id: `day-${position}`, position },
    ),
  );
  for (const result of itineraryDays(days)) {
    expect(result.stops[0].time).toBe("09:00");
    expect(result.stops[0].details).toEqual([]);
    expect(result.stops[0].warnings).toEqual([]);
    expect(result.stops[1].details).toContainEqual({
      kind: "info",
      text: "到达时间待定",
    });
  }
});

it("orders days without changing their day numbers and handles missing dates and empty days", () => {
  const result = itineraryDays([
    day([], { id: "third", position: 2, date: null }),
    day([]),
  ]);
  expect(result.map((day) => day.number)).toEqual([1, 3]);
  expect(result[1]).toMatchObject({ date: "日期待定", stops: [] });
  expect(itineraryDate("2026-10-02")).toBe("10月2日星期五");
  expect(itineraryDays([])).toEqual([]);
});

it("wraps Chinese, emoji, long words and explicit newlines without losing content", () => {
  const source = "出发👨‍👩‍👧‍👦杭州\n\nlongword";
  const lines = wrapPosterText(
    source,
    2,
    (text) =>
      [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)]
        .length,
  );
  expect(lines).toEqual(["出发", "👨‍👩‍👧‍👦杭", "州", "", "lo", "ng", "wo", "rd"]);
  expect(itineraryFilename("杭州/上海:周末")).toBe("杭州_上海_周末");
});

it("creates a readable ZIP directory with UTF-8 names, byte sizes, offsets and standard CRC32", async () => {
  const content = new Blob(["123456789"]);
  const archive = await posterArchive(
    [
      { blob: content, width: 1, height: 1 },
      { blob: content, width: 1, height: 1 },
    ],
    "杭州",
  );
  const buffer = await archive.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint32(14, true)).toBe(0xcbf43926);
  const nameSize = view.getUint16(26, true);
  expect(new TextDecoder().decode(bytes.slice(30, 30 + nameSize))).toBe(
    "杭州-01.png",
  );
  expect(
    new TextDecoder().decode(bytes.slice(30 + nameSize, 39 + nameSize)),
  ).toBe("123456789");
  const end = buffer.byteLength - 22;
  expect(view.getUint16(end + 10, true)).toBe(2);
  const directory = view.getUint32(end + 16, true);
  expect(view.getUint32(directory, true)).toBe(0x02014b50);
  const second = directory + 46 + nameSize;
  expect(view.getUint32(second + 42, true)).toBe(39 + nameSize);
  expect(view.getUint32(end + 12, true)).toBe(end - directory);
});
