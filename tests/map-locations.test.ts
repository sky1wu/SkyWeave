import { it, expect } from "vitest";
import { mapLocations } from "@/domain/map-locations";
import { transportInput } from "@/domain/transport";
import type { DayPlan, Item, PoolPlace } from "@/domain/types";
const revision = {
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  updatedByUserId: "user",
};
const pool = (
  id: string,
  lat: number | null = 22,
  lng: number | null = 114,
): PoolPlace => ({
  id,
  tripId: "trip",
  title: id,
  type: "place",
  position: 0,
  placeCategory: "景点",
  amapPoiId: null,
  address: null,
  lat,
  lng,
  notes: null,
  ...revision,
});
const item = (id: string, data: Partial<Item> = {}): Item => ({
  id,
  dayId: "day",
  title: id,
  type: "place",
  position: 0,
  placeCategory: "景点",
  sourcePlaceId: null,
  description: null,
  notes: null,
  lat: 22,
  lng: 114,
  amapPoiId: null,
  address: null,
  startMinutes: null,
  endMinutes: null,
  fixedTime: false,
  stayMinutes: 0,
  transport: null,
  ...revision,
  ...data,
});
const day = (id: string, items: Item[]): DayPlan => ({
  id,
  tripId: "trip",
  title: id,
  date: null,
  startMinutes: 480,
  position: 0,
  items,
  legs: [],
  ...revision,
});
it("shows the active day and globally unplanned places, without notes or missing coordinates", () => {
  const today = day("day1", [
    item("visit", { sourcePlaceId: "booked" }),
    item("note", { type: "note", position: 1 }),
  ]);
  const tomorrow = day("day2", [
    item("tomorrow", { sourcePlaceId: "tomorrow-pool" }),
  ]);
  const points = mapLocations(
    today,
    [
      pool("booked"),
      pool("tomorrow-pool"),
      pool("pending"),
      pool("unlocated", null, null),
    ],
    [today, tomorrow],
  );
  expect(points.map((p) => p.id)).toEqual(["visit", "pool:pending"]);
  expect(points[0]).toMatchObject({ number: 1, title: "visit" });
  expect(points[1]).toMatchObject({ title: "pending", category: "景点" });
});
it("shows independent departure and arrival markers and counts linked pool endpoints as arranged", () => {
  const transport = transportInput.parse({
    mode: "flight",
    origin: {
      name: "深圳机场",
      lat: 22.6,
      lng: 113.8,
      sourcePlaceId: "airport",
    },
    destination: { name: "北京机场", lat: 40, lng: 116.6 },
  });
  const current = day("day", [
    item("flight", { type: "transport", transport, lat: null, lng: null }),
  ]);
  const points = mapLocations(current, [pool("airport")], [current]);
  expect(points).toHaveLength(2);
  expect(points.map((p) => p.id)).toEqual([
    "flight:origin",
    "flight:destination",
  ]);
  expect(points.map((p) => p.title)).toEqual(["深圳机场", "北京机场"]);
  expect(points.every((p) => p.category === "飞机")).toBe(true);
});

it("keeps nearby permanent labels apart and clear of marker hit areas", async () => {
  const { placeMapLabels } = await import("@/domain/map-labels");
  const anchors = [
    { x: 220, y: 210, width: 170, height: 38 },
    { x: 236, y: 228, width: 150, height: 25 },
    { x: 245, y: 270, width: 130, height: 25 },
    { x: 222, y: 290, width: 100, height: 25 },
  ];
  const result = placeMapLabels(anchors, {
    x: 30,
    y: 30,
    width: 500,
    height: 500,
  });
  const touches = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
  for (const [i, label] of result.entries()) {
    expect(label.x).toBeGreaterThanOrEqual(30);
    expect(label.x + label.width).toBeLessThanOrEqual(530);
    expect(result.slice(i + 1).some((other) => touches(label, other))).toBe(
      false,
    );
    expect(
      anchors.some((p) =>
        touches(label, { x: p.x - 17, y: p.y - 17, width: 34, height: 34 }),
      ),
    ).toBe(false);
  }
});
