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
    480 * 60,
    480 * 60,
    512 * 60,
    562 * 60,
  ]);
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
