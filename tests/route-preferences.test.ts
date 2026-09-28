import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Mode } from "@/domain/types";

process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/route-preferences-`)}/test.sqlite`;
const s = await import("@/server/service");
const p = await import("@/server/places");
const { insert } = await import("@/server/db");
const actor = { id: "planner", name: "Planner", email: "planner@example.test" };
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });

function setup() {
  const { id } = s.createTrip(actor, {
    title: "记住交通方式",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const [day, nextDay] = s.snapshot(id, actor).days;
  const a = s.createItem(day.id, actor, { title: "A", lat: 22, lng: 114 });
  const b = s.createItem(day.id, actor, { title: "B", lat: 23, lng: 115 });
  return { tripId: id, dayId: day.id, nextDayId: nextDay.id, a, b };
}

function chooseMode(dayId: string, mode: Mode, index = 0) {
  const leg = s.getDay(dayId).legs[index];
  s.editLeg(leg.id, actor, { expectedVersion: leg.version, mode });
  return leg.id;
}

function insertBetween(tripId: string, dayId: string, beforeItemId: string) {
  const place = p.savePoolPlace(tripId, actor, {
    title: "临时地点",
    lat: 24,
    lng: 116,
  });
  return p.schedulePlace(tripId, place.id, actor, {
    dayId,
    beforeItemId,
    expectedVersion: 1,
    expectedDayVersion: s.getDay(dayId).version,
  });
}

function removeItem(dayId: string, itemId: string) {
  const item = s.getDay(dayId).items.find((item) => item.id === itemId)!;
  s.deleteItem(item.id, actor, item.version);
}

describe("route mode preferences", () => {
  it.each(["walking", "driving", "cycling", "transit", "manual"] as const)(
    "uses the last selected %s mode for consecutive new legs",
    (mode) => {
      const { dayId } = setup();
      expect(s.getDay(dayId).legs[0].mode).toBe("transit");
      chooseMode(dayId, mode);
      s.createItem(dayId, actor, { title: "C", lat: 24, lng: 116 });
      s.createItem(dayId, actor, { title: "D", lat: 25, lng: 117 });
      const legs = s.getDay(dayId).legs;
      expect(legs).toHaveLength(3);
      expect(legs.every((leg) => leg.mode === mode)).toBe(true);
      expect(legs[2]).toMatchObject({
        provider: mode === "manual" ? "manual" : "amap",
        status: mode === "manual" ? "ready" : "pending",
        manualDurationMinutes: null,
        manualDistanceMeters: null,
        manualDescription: null,
        requestKey: null,
        selectedAlternativeId: null,
        alternatives: [],
      });
    },
  );

  it("restores the original pair after insertion and deletion while keeping the newest default", () => {
    const { tripId, dayId, a, b } = setup();
    chooseMode(dayId, "walking");
    const inserted = insertBetween(tripId, dayId, b.id);
    expect(s.getDay(dayId).legs.map((leg) => leg.mode)).toEqual([
      "walking",
      "walking",
    ]);
    chooseMode(dayId, "driving");
    removeItem(dayId, inserted.id);
    expect(s.getDay(dayId).legs).toEqual([
      expect.objectContaining({
        fromItemId: a.id,
        toItemId: b.id,
        mode: "walking",
        status: "pending",
        requestKey: null,
        selectedAlternativeId: null,
        alternatives: [],
      }),
    ]);
    s.createItem(dayId, actor, { title: "C", lat: 25, lng: 117 });
    expect(s.getDay(dayId).legs.map((leg) => leg.mode)).toEqual([
      "walking",
      "driving",
    ]);

    // A later edit to the restored pair must replace its remembered setting.
    chooseMode(dayId, "cycling");
    const second = insertBetween(tripId, dayId, b.id);
    removeItem(dayId, second.id);
    expect(
      s
        .getDay(dayId)
        .legs.find((leg) => leg.fromItemId === a.id && leg.toItemId === b.id)
        ?.mode,
    ).toBe("cycling");
  });

  it("restores manual details only for the original pair", () => {
    const { tripId, dayId, b } = setup();
    const leg = s.getDay(dayId).legs[0];
    const manual = {
      mode: "manual",
      manualDurationMinutes: 35,
      manualDistanceMeters: 2500,
      manualDescription: "乘船过江",
    };
    s.editLeg(leg.id, actor, { expectedVersion: leg.version, ...manual });
    const inserted = insertBetween(tripId, dayId, b.id);
    for (const leg of s.getDay(dayId).legs)
      expect(leg).toMatchObject({
        mode: "manual",
        manualDurationMinutes: null,
        manualDistanceMeters: null,
        manualDescription: null,
      });
    removeItem(dayId, inserted.id);
    expect(s.getDay(dayId).legs[0]).toMatchObject({
      ...manual,
      provider: "manual",
      status: "ready",
    });
  });

  it("retains the last selection after all old legs are deleted and across days, scoped to the trip", () => {
    const { dayId, nextDayId, b } = setup();
    chooseMode(dayId, "cycling");
    removeItem(dayId, b.id);
    expect(s.getDay(dayId).legs).toHaveLength(0);
    s.createItem(nextDayId, actor, { title: "D", lat: 24, lng: 116 });
    s.createItem(nextDayId, actor, { title: "E", lat: 25, lng: 117 });
    expect(s.getDay(nextDayId).legs[0].mode).toBe("cycling");
    expect(s.getDay(setup().dayId).legs[0].mode).toBe("transit");
  });

  it("does not treat an automatic same-place leg as the last selected mode", () => {
    const { dayId } = setup();
    chooseMode(dayId, "driving");
    const same = s.createItem(dayId, actor, {
      title: "同一地点",
      lat: 23,
      lng: 115,
    });
    expect(s.getDay(dayId).legs[1]).toMatchObject({
      mode: "manual",
      manualDurationMinutes: 0,
      manualDescription: "同一地点，无需移动",
    });
    s.createItem(dayId, actor, { title: "D", lat: 25, lng: 117 });
    expect(s.getDay(dayId).legs[2].mode).toBe("driving");
    s.editItem(same.id, actor, {
      expectedVersion: s.getDay(dayId).items.find((i) => i.id === same.id)!
        .version,
      lat: 24,
      lng: 116,
    });
    expect(s.getDay(dayId).legs[1]).toMatchObject({
      mode: "driving",
      provider: "amap",
      status: "pending",
      manualDurationMinutes: null,
      manualDistanceMeters: null,
      manualDescription: null,
    });
  });

  it("keeps an explicit choice on a same-place pair when it becomes adjacent again", () => {
    const { tripId, dayId, b } = setup();
    s.editItem(b.id, actor, { expectedVersion: 1, lat: 22, lng: 114 });
    chooseMode(dayId, "walking");
    const inserted = insertBetween(tripId, dayId, b.id);
    removeItem(dayId, inserted.id);
    expect(s.getDay(dayId).legs[0]).toMatchObject({
      mode: "walking",
      provider: "amap",
    });
  });

  it("does not change the default on other leg edits or rejected mode changes", () => {
    const { dayId } = setup();
    chooseMode(dayId, "manual");
    s.createItem(dayId, actor, { title: "C", lat: 24, lng: 116 });
    chooseMode(dayId, "walking", 1);
    const first = s.getDay(dayId).legs[0];
    s.editLeg(first.id, actor, {
      expectedVersion: first.version,
      manualDurationMinutes: 30,
    });
    expect(() =>
      s.editLeg(first.id, actor, {
        expectedVersion: first.version,
        mode: "driving",
      }),
    ).toThrow();
    s.createItem(dayId, actor, { title: "D", lat: 25, lng: 117 });
    expect(s.getDay(dayId).legs[2].mode).toBe("walking");
  });
});
