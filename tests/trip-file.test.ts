import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { tripFilename } from "@/domain/trip-file";
import type { TripFile } from "@/server/trip-file-schema";

const directory = mkdtempSync(`${tmpdir()}/trip-file-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const files = await import("@/server/trip-file-service");
const { savePoolPlace } = await import("@/server/places");
const { insert, update, many, sqlite } = await import("@/server/db");
const owner = { id: "file-owner", name: "原作者", email: "owner@example.test" };
const importer = {
  id: "file-importer",
  name: "导入者",
  email: "importer@example.test",
};
const viewer = {
  id: "file-viewer",
  name: "只读成员",
  email: "viewer@example.test",
};

beforeAll(() => {
  for (const actor of [owner, importer, viewer])
    insert("users", { ...actor, createdAt: Date.now(), updatedAt: Date.now() });
});
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const trip = s.createTrip(owner, {
    title: "杭州 / 上海之旅",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const before = s.snapshot(trip.id, owner);
  const place = savePoolPlace(trip.id, owner, {
    title: "杭州站",
    lat: 30.25,
    lng: 120.18,
    amapPoiId: "B001",
    placeCategory: "交通",
    notes: "从东广场进入",
  });
  const destination = savePoolPlace(trip.id, owner, {
    title: "上海站",
    lat: 31.25,
    lng: 121.45,
    amapPoiId: "B002",
  });
  s.createItem(before.days[0].id, owner, {
    title: "集合",
    sourcePlaceId: place.id,
    lat: 30.25,
    lng: 120.18,
    notes: "中文备注 🌄",
  });
  const train = s.createItem(before.days[0].id, owner, {
    title: "夜间列车",
    type: "transport",
    fixedTime: true,
    startMinutes: 1410,
    endMinutes: 1530,
    transport: {
      mode: "train",
      status: "confirmed",
      serviceNumber: "D123",
      origin: {
        name: "杭州站",
        sourcePlaceId: place.id,
        lat: 30.25,
        lng: 120.18,
      },
      destination: {
        name: "上海站",
        sourcePlaceId: destination.id,
        lat: 31.25,
        lng: 121.45,
      },
    },
  });
  s.createItem(before.days[0].id, owner, {
    title: "入住酒店",
    type: "hotel",
    lat: 31.24,
    lng: 121.46,
    stayMinutes: 60,
  });
  s.createItem(before.days[1].id, owner, {
    title: "自由活动",
    type: "note",
    description: "当天没有固定安排",
  });
  const planned = s.snapshot(trip.id, owner);
  const leg = planned.days[0].legs[1];
  insert("route_alternatives", {
    id: crypto.randomUUID(),
    travelLegId: leg.id,
    fingerprint: "route-fingerprint",
    position: 0,
    label: "方案 1",
    distanceMeters: 2000,
    durationSeconds: 600,
    walkingDistanceMeters: 100,
    transferCount: 0,
    polyline: [
      [121.45, 31.25],
      [121.46, 31.24],
    ],
    steps: [
      {
        mode: "walking",
        instruction: "步行至酒店",
        distanceMeters: 2000,
        durationSeconds: 600,
      },
    ],
    summary: "步行",
    geometryComplete: true,
    fetchedAt: Date.now(),
  });
  const alternative = s.snapshot(trip.id, owner).days[0].legs[1]
    .alternatives[0];
  update("travel_legs", leg.id, {
    selectedAlternativeId: alternative.id,
    selectionSource: "user",
    status: "ready",
  });
  const guest = s.createParticipant(trip.id, owner, { name: "同行朋友" });
  s.saveExpense(trip.id, owner, {
    title: "车票",
    category: "transport",
    amountMinor: 101,
    currency: "HKD",
    exchangeRateToBase: "0.9",
    payerParticipantId: before.participants[0].id,
    splitMethod: "equal",
    splitMeta: [
      { participantId: before.participants[0].id, value: "1" },
      { participantId: guest.id, value: "1" },
    ],
    incurredAt: Date.now(),
    dayId: before.days[0].id,
    dayItemId: train.id,
    notes: "保留分摊尾差",
  });
  s.createSettlement(trip.id, owner, {
    fromParticipantId: guest.id,
    toParticipantId: before.participants[0].id,
    amountMinor: 20,
    currency: "CNY",
    exchangeRateToBase: "1",
    settledAt: Date.now(),
    note: "已转账",
  });
  s.editParticipant(trip.id, guest.id, owner, {
    expectedVersion: 1,
    status: "inactive",
  });
  s.addComment(trip.id, owner, {
    targetType: "trip",
    targetId: trip.id,
    content: "内部讨论不导出",
  });
  s.createInvite(trip.id, owner, {});
  return trip.id;
}

function comparable(file: TripFile) {
  const ids = new Map<string, string>();
  file.poolPlaces.forEach((row) => ids.set(row.id, `place:${row.title}`));
  file.participants.forEach((row) => ids.set(row.id, `person:${row.name}`));
  file.expenses.forEach((row) => ids.set(row.id, `expense:${row.title}`));
  file.settlements.forEach((row, i) => ids.set(row.id, `settlement:${i}`));
  file.days.forEach((day, i) => {
    ids.set(day.id, `day:${i}`);
    day.items.forEach((row) => ids.set(row.id, `item:${row.title}`));
    day.legs.forEach((leg, j) => {
      ids.set(leg.id, `leg:${i}:${j}`);
      leg.alternatives.forEach((row, k) =>
        ids.set(row.id, `alternative:${i}:${j}:${k}`),
      );
    });
  });
  const result = JSON.parse(
    JSON.stringify(file, (key, value) =>
      key === "exportedAt"
        ? undefined
        : typeof value === "string"
          ? (ids.get(value) ?? value)
          : value,
    ),
  ) as TripFile;
  result.participants.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

describe("portable trip files", () => {
  it("round-trips all planning and ledger fields, remaps references, preserves rounding, and creates independent copies", () => {
    const originalId = fixture();
    const original = s.snapshot(originalId, owner);
    const exported = files.exportTripFile(originalId, owner);
    const json = JSON.stringify(exported);
    for (const privateValue of [
      owner.id,
      owner.email,
      "updatedByUserId",
      "createdByUserId",
      "userId",
      "members",
      "invites",
      "内部讨论不导出",
    ])
      expect(json).not.toContain(privateValue);
    let file = exported;
    for (let attempt = 0; attempt < 3; attempt++) {
      const imported = files.importTripFile(
        importer,
        JSON.parse(JSON.stringify(file)),
      );
      expect(imported.id).not.toBe(originalId);
      const snapshot = s.snapshot(imported.id, importer);
      expect(snapshot.members).toHaveLength(1);
      expect(snapshot.members[0]).toMatchObject({
        userId: importer.id,
        role: "owner",
      });
      expect(
        snapshot.participants.every((person) => person.userId === null),
      ).toBe(true);
      expect(snapshot.comments).toHaveLength(0);
      expect(snapshot.invites).toHaveLength(0);
      expect(snapshot.activity).toHaveLength(1);
      expect(snapshot.days[0].id).not.toBe(original.days[0].id);
      expect(snapshot.days[0].items[1].transport?.origin.sourcePlaceId).toBe(
        snapshot.poolPlaces[0].id,
      );
      expect(snapshot.expenses[0].dayItemId).toBe(snapshot.days[0].items[1].id);
      expect(snapshot.days[0].legs[1].selectedAlternativeId).toBe(
        snapshot.days[0].legs[1].alternatives[0].id,
      );
      file = files.exportTripFile(imported.id, importer);
      expect(comparable(file)).toEqual(comparable(exported));
    }
    expect(s.snapshot(originalId, owner)).toEqual(original);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("allows active members to export, denies outsiders and removed members, and returns a downloadable response", async () => {
    const id = fixture();
    expect(() => files.exportTripFile(id, importer)).toThrow();
    s.joinInvite(s.createInvite(id, owner, { role: "viewer" }).token, viewer);
    expect(files.exportTripFile(id, viewer).trip.title).toBe("杭州 / 上海之旅");
    const response = files.tripFileResponse(id, viewer);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("杭州 _ 上海之旅.skyweave.json"),
    );
    expect((await response.json()).version).toBe(1);
    s.editMember(id, viewer.id, owner, {
      expectedVersion: 1,
      status: "inactive",
    });
    expect(() => files.exportTripFile(id, viewer)).toThrow();
    expect(tripFilename('../../旅行\n"?.')).toBe(".._.._旅行___.skyweave.json");
  });

  it("rejects damaged graphs, unsupported versions and inconsistent money without leaving partial trips", () => {
    const id = fixture();
    const original = files.exportTripFile(id, owner);
    const before = s.listTrips(importer);
    const mutations: ((file: TripFile) => void)[] = [
      (file) => {
        Object.assign(file, { version: 999 });
      },
      (file) => {
        file.days[1].date = "2026-11-01";
      },
      (file) => {
        file.days[1].id = file.days[0].id;
      },
      (file) => {
        file.days[0].items[0].sourcePlaceId = "foreign-place";
      },
      (file) => {
        file.days[0].items[1].transport!.destination.sourcePlaceId =
          "foreign-place";
      },
      (file) => {
        file.days[0].legs[0].toItemId = file.days[1].items[0].id;
      },
      (file) => {
        file.days[0].legs[1].selectedAlternativeId = "foreign-alternative";
      },
      (file) => {
        file.poolPlaces[1].amapPoiId = file.poolPlaces[0].amapPoiId;
      },
      (file) => {
        file.expenses[0].dayId = file.days[1].id;
      },
      (file) => {
        file.expenses[0].payerParticipantId = "foreign-participant";
      },
      (file) => {
        file.expenses[0].splits[0].baseAmountMinor++;
      },
      (file) => {
        file.settlements[0].exchangeRateToBase = "0";
      },
    ];
    for (const mutate of mutations) {
      const file = structuredClone(original);
      mutate(file);
      expect(() => files.importTripFile(importer, file)).toThrow();
      expect(s.listTrips(importer)).toEqual(before);
    }
    for (const invalid of [
      null,
      [],
      {},
      { format: "other" },
      { ...original, days: null },
    ])
      expect(() => files.importTripFile(importer, invalid)).toThrow("行程文件");
  });

  it("rolls back every table when persistence fails mid-import", () => {
    const file = files.exportTripFile(fixture(), owner);
    const tables = [
      "trips",
      "trip_members",
      "trip_participants",
      "trip_places",
      "days",
      "day_items",
      "travel_legs",
      "route_alternatives",
      "expenses",
      "expense_splits",
      "settlements",
      "activity_logs",
    ];
    const counts = () =>
      tables.map((table) => many(`SELECT count(*) n FROM ${table}`));
    const before = counts();
    sqlite.exec(
      "CREATE TEMP TRIGGER fail_trip_import BEFORE INSERT ON settlements BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END",
    );
    try {
      expect(() => files.importTripFile(importer, file)).toThrow(
        "simulated write failure",
      );
    } finally {
      sqlite.exec("DROP TRIGGER fail_trip_import");
    }
    expect(counts()).toEqual(before);
  });
});
