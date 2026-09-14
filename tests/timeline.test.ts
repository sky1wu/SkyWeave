import { it, expect } from "vitest";
import {
  calculateTimeline,
  routePairs,
  formatTime,
  departureISO,
} from "@/domain/timeline";
import type { DayPlan, Item, Leg } from "@/domain/types";
const rev = { version: 1, createdAt: 0, updatedAt: 0, updatedByUserId: "u" };
export function item(
  id: string,
  position: number,
  data: Partial<Item> = {},
): Item {
  return {
    id,
    position,
    dayId: "d",
    sourcePlaceId: null,
    placeCategory: "未分类",
    title: id,
    type: "place",
    description: null,
    notes: null,
    address: null,
    amapPoiId: null,
    lat: 22,
    lng: 114,
    fixedTime: false,
    startMinutes: null,
    endMinutes: null,
    stayMinutes: 0,
    transport: null,
    ...rev,
    ...data,
  };
}
function leg(
  fromItemId: string,
  toItemId: string,
  duration: number | null,
): Leg & { alternatives: [] } {
  return {
    id: fromItemId + toItemId,
    dayId: "d",
    fromItemId,
    toItemId,
    mode: "manual",
    provider: "manual",
    manualDurationMinutes: duration,
    manualDistanceMeters: null,
    manualDescription: null,
    selectedAlternativeId: null,
    selectionSource: "recommended",
    status: "ready",
    error: null,
    requestKey: null,
    alternatives: [],
    ...rev,
  };
}
function day(
  items: Item[],
  legs: DayPlan["legs"],
  startMinutes = 480,
): DayPlan {
  return {
    id: "d",
    tripId: "t",
    title: "Day",
    date: "2026-10-02",
    position: 0,
    startMinutes,
    items,
    legs,
    ...rev,
  };
}
it("calculates travel, stays, and a note without breaking geography", () => {
  const items = [
    item("a", 0),
    item("note", 1, { type: "note", lat: null, lng: null, stayMinutes: 5 }),
    item("b", 2, { stayMinutes: 30 }),
    item("c", 3),
  ];
  expect(routePairs(items).map(([a, b]) => a.id + b.id)).toEqual(["ab", "bc"]);
  const result = calculateTimeline(
    day(items, [leg("a", "b", 27), leg("b", "c", 20)]),
  );
  expect(result.entries.map((i) => i.arrival)).toEqual([
    null,
    480 * 60,
    512 * 60,
    562 * 60,
  ]);
});
it("starts with the first appointment's schedule without estimating an inbound arrival", () => {
  const first = item("first", 3, {
    fixedTime: true,
    startMinutes: 420,
    endMinutes: 450,
  });
  const next = item("next", 8, {
    fixedTime: true,
    startMinutes: 480,
    endMinutes: 510,
  });
  const result = calculateTimeline(
    day([next, first], [leg("first", "next", 15)]),
  );
  expect(result.entries[0]).toMatchObject({
    itemId: "first",
    isDayStart: true,
    arrival: null,
    start: 420 * 60,
    departure: 450 * 60,
    earlyMinutes: 0,
    lateMinutes: 0,
    warnings: [],
  });
  expect(result.departures.firstnext).toBe(450 * 60);
  expect(result.entries[1]).toMatchObject({
    isDayStart: false,
    arrival: 465 * 60,
    earlyMinutes: 15,
    warnings: [],
  });
});
it("keeps fixed end times when late and never rewinds after a missed event", () => {
  const items = [
    item("a", 0),
    item("e", 1, { fixedTime: true, startMinutes: 720, endMinutes: 780 }),
    item("b", 2),
  ];
  const late = calculateTimeline(
    day(items, [leg("a", "e", 248), leg("e", "b", 10)]),
  );
  expect(late.entries[1].lateMinutes).toBe(8);
  expect(late.entries[2].arrival).toBe(790 * 60);
  const missed = calculateTimeline(
    day(items, [leg("a", "e", 320), leg("e", "b", 10)]),
  );
  expect(missed.entries[1].warnings.join()).toContain("错过");
  expect(missed.entries[2].arrival).toBe(810 * 60);
  const early = calculateTimeline(
    day(items, [leg("a", "e", 215), leg("e", "b", 10)]),
  );
  expect(early.entries[1].earlyMinutes).toBe(25);
});
it("propagates unknown routes until an explicit time anchor", () => {
  const items = [
    item("a", 0),
    item("b", 1),
    item("c", 2, { fixedTime: true, startMinutes: 720, endMinutes: 780 }),
    item("d", 3),
  ];
  const r = calculateTimeline(
    day(items, [leg("a", "b", null), leg("b", "c", 10), leg("c", "d", 20)]),
  );
  expect(r.entries[1].arrival).toBeNull();
  expect(r.entries[2].arrival).toBeNull();
  expect(r.entries[3].arrival).toBe(800 * 60);
});
it("supports overnight travel and warns for non-geographic actual places", () => {
  const r = calculateTimeline(
    day([item("a", 0), item("b", 1)], [leg("a", "b", 90)], 23 * 60 + 30),
  );
  expect(formatTime(r.entries[1].arrival)).toBe("次日 01:00");
  expect(departureISO("2026-10-02", 25 * 3600, "Asia/Shanghai")).toBe(
    "2026-10-03T01:00:00.000+08:00",
  );
  expect(
    routePairs([
      item("a", 0),
      item("b", 1, { lat: null, lng: null }),
      item("c", 2),
    ]),
  ).toEqual([]);
});

const { transportInput, routeEndpoint } = await import("@/domain/transport");
const rail = transportInput.parse({
  mode: "train",
  origin: { name: "出发站", lat: 22.6, lng: 114.1 },
  destination: { name: "到达站", lat: 39.8, lng: 116.4 },
});
it.each([480, 1320])(
  "does not infer early arrival or a missed flight for the first item when the day starts at %i minutes",
  (startMinutes) => {
    const flight = item("flight", 0, {
      type: "transport",
      fixedTime: true,
      startMinutes: 19 * 60 + 5,
      endMinutes: 21 * 60 + 55,
      transport: { ...rail, mode: "flight" },
    });
    const result = calculateTimeline(
      day(
        [flight, item("hotel", 1)],
        [leg("flight", "hotel", 15)],
        startMinutes,
      ),
    );
    expect(result.entries[0]).toMatchObject({
      arrival: null,
      start: (19 * 60 + 5) * 60,
      departure: (21 * 60 + 55) * 60,
      earlyMinutes: 0,
      lateMinutes: 0,
      warnings: [],
    });
    expect(result.entries[1].arrival).toBe((22 * 60 + 10) * 60);
  },
);
it("connects to the departure station and from the arrival station around an independent journey", () => {
  const a = item("a", 0),
    trip = item("t", 1, {
      type: "transport",
      lat: null,
      lng: null,
      transport: rail,
      startMinutes: 540,
      endMinutes: 720,
      fixedTime: true,
    }),
    b = item("b", 2);
  expect(routePairs([a, trip, b]).map(([a, b]) => [a.id, b.id])).toEqual([
    ["a", "t"],
    ["t", "b"],
  ]);
  expect(routeEndpoint(trip, "arrival")).toEqual(rail.origin);
  expect(routeEndpoint(trip, "departure")).toEqual(rail.destination);
  const result = calculateTimeline(
    day([a, trip, b], [leg("a", "t", 20), leg("t", "b", 15)]),
  );
  expect(result.entries[1]).toMatchObject({
    arrival: 500 * 60,
    start: 540 * 60,
    departure: 720 * 60,
    earlyMinutes: 40,
  });
  expect(result.entries[2].arrival).toBe(735 * 60);
  expect(result.entries[1].warnings).not.toContain("地点没有坐标");
});
it("does not treat an undetermined train or flight duration as zero or bypass its unknown endpoints", () => {
  const trip = item("t", 1, {
    type: "transport",
    lat: null,
    lng: null,
    transport: rail,
  });
  const result = calculateTimeline(
    day(
      [item("a", 0), trip, item("b", 2)],
      [leg("a", "t", 20), leg("t", "b", 15)],
    ),
  );
  expect(result.entries[1].start).toBeNull();
  expect(result.entries[1].departure).toBeNull();
  expect(result.entries[2].arrival).toBeNull();
  const unknown = {
    ...trip,
    transport: transportInput.parse({
      mode: "flight",
      origin: { name: "深圳" },
      destination: { name: "北京" },
    }),
  };
  expect(routePairs([item("a", 0), unknown, item("b", 2)])).toEqual([]);
});
it("missed departures leave downstream times uncertain instead of teleporting to the destination", () => {
  const trip = item("t", 1, {
    type: "transport",
    transport: rail,
    startMinutes: 490,
    endMinutes: 720,
    fixedTime: true,
  });
  const result = calculateTimeline(
    day(
      [item("a", 0), trip, item("b", 2)],
      [leg("a", "t", 20), leg("t", "b", 15)],
    ),
  );
  expect(result.entries[1].lateMinutes).toBe(10);
  expect(result.entries[1].warnings.join()).toContain("赶不上");
  expect(result.entries[1].departure).toBeNull();
  expect(result.entries[2].arrival).toBeNull();
});
it("supports estimated durations and overnight independent travel", () => {
  const estimated = item("t", 0, {
    type: "transport",
    transport: { ...rail, durationMinutes: 90 },
  });
  expect(calculateTimeline(day([estimated], [])).entries[0].departure).toBe(
    570 * 60,
  );
  const overnight = {
    ...estimated,
    startMinutes: 1410,
    endMinutes: 1510,
    fixedTime: true,
  };
  const result = calculateTimeline(
    day([overnight, item("b", 1)], [leg("t", "b", 15)], 1380),
  );
  expect(formatTime(result.entries[0].departure)).toBe("次日 01:10");
  expect(formatTime(result.entries[1].arrival)).toBe("次日 01:25");
});
