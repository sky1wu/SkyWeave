import { afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { calculateTripTimelines } from "@/domain/timeline";
import { itineraryDays } from "@/domain/itinerary";
import {
  contextualDays,
  participantDay,
  type ParallelPlan,
} from "@/domain/parallel";
const directory = mkdtempSync(`${tmpdir()}/trip-origins-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const core = await import("@/server/service-core");
const bulk = await import("@/server/parallel-service");
const places = await import("@/server/places");
const files = await import("@/server/trip-file-service");
const { insert, sqlite } = await import("@/server/db");
const actor = {
  id: "origin-owner",
  name: "全程成员",
  email: "origin-owner@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
function setup(endDate = "2026-10-04") {
  const { id } = s.createTrip(actor, {
    title: "不同出发地与中途加入",
    startDate: "2026-10-01",
    endDate,
  });
  const people = [
    s.snapshot(id, actor).participants[0].id,
    s.createParticipant(id, actor, { name: "中途成员" }).id,
    s.createParticipant(id, actor, { name: "另一同行者" }).id,
  ];
  const days = () => core.getDays(id),
    ids = days().map((d) => d.id);
  const item = (title: string, index = 0, data: Record<string, unknown> = {}) =>
    s.createItem(ids[index], actor, { title, lat: 22, lng: 114, ...data }).id;
  const versions = () =>
    days().map((day) => ({ id: day.id, expectedVersion: day.version }));
  const branch = (title: string, participantIds: string[]) => ({
    id: crypto.randomUUID(),
    title,
    participantIds,
    startMinutes: null,
  });
  const save = (
    plan: ParallelPlan,
    day = 2,
    extras: Record<string, unknown> = {},
  ) =>
    bulk.saveParallel(id, actor, {
      dayId: ids[day],
      title: "第三天集合",
      parallelPlan: plan,
      expectedDays: versions(),
      ...extras,
    });
  const manual = () => {
    for (const leg of days().flatMap((day) => day.legs))
      s.editLeg(leg.id, actor, {
        expectedVersion: leg.version,
        mode: "manual",
        manualDurationMinutes: 30,
      });
  };
  return { id, people, days, ids, item, branch, versions, save, manual };
}
it("sets different group origins in one save without forcing a shared departure", () => {
  const f = setup(),
    shared = f.item("默认酒店", 2),
    meet = f.item("游艇会", 2, { fixedTime: true, startMinutes: 720 });
  const branches = [
    f.branch("车站组", [f.people[0]]),
    f.branch("机场组", [f.people[1]]),
  ];
  const station = places.savePoolPlace(f.id, actor, {
    title: "车站",
    lat: 22.1,
    lng: 114.1,
  });
  const saved = f.save(
    { splitItemId: shared, joinItemId: meet, joinPolicy: "wait_all", branches },
    2,
    {
      departures: [
        {
          branchId: branches[0].id,
          source: { kind: "pool", placeId: station.id },
        },
        {
          branchId: branches[1].id,
          source: {
            kind: "place",
            place: { title: "机场", lat: 22.2, lng: 114.2 },
          },
        },
      ],
    },
  );
  const day = f.days()[2],
    section = day.items.find((i) => i.id === saved.id)!;
  const origins = section.parallelPlan!.branches.map((b) => b.departureItemId!);
  expect(origins.every((id) => day.items.some((i) => i.id === id))).toBe(true);
  expect(
    day.legs
      .filter((leg) => branches.some((b) => b.id === leg.branchId))
      .map((leg) => leg.fromItemId)
      .sort(),
  ).toEqual([...origins].sort());
  expect(day.legs.some((leg) => leg.fromItemId === shared)).toBe(false);
  f.manual();
  expect(
    calculateTripTimelines(f.days())
      .get(day.id)!
      .entries.find((e) => e.itemId === meet)?.start,
  ).toBe(720 * 60);
});
it("keeps earlier activities for full travelers and excludes them for a departure-stage entrant", () => {
  const f = setup(),
    first = f.item("第一天活动"),
    second = f.item("第二天活动", 1),
    meet = f.item("第三天集合", 2, { fixedTime: true, startMinutes: 600 });
  const a = f.branch("已同行组", [f.people[0]]),
    b = {
      ...f.branch("中途加入组", [f.people[1]]),
      entrants: [{ participantId: f.people[1], at: "departure" as const }],
    };
  f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    2,
    {
      departures: [
        {
          branchId: a.id,
          source: {
            kind: "place",
            place: { title: "酒店", lat: 22, lng: 114 },
          },
        },
        {
          branchId: b.id,
          source: {
            kind: "place",
            place: { title: "车站", lat: 22.1, lng: 114.1 },
          },
        },
      ],
    },
  );
  f.manual();
  const participants = s.snapshot(f.id, actor).participants;
  const late = itineraryDays(f.days(), participants, f.people[1]);
  expect(late[0].stops).toEqual([]);
  expect(late[1].stops).toEqual([]);
  expect(late[2].stops.some((stop) => stop.title === "车站")).toBe(true);
  const full = itineraryDays(f.days(), participants, f.people[0]);
  expect(full[0].stops.some((stop) => stop.id === first)).toBe(true);
  expect(full[1].stops.some((stop) => stop.id === second)).toBe(true);
});
it("allows mixed participation in one group and waits for a direct arrival at the meeting", () => {
  const f = setup(),
    early = f.item("前两天游览"),
    meet = f.item("游艇会", 2, { fixedTime: true, startMinutes: 600 }),
    later = f.item("一起午餐", 2);
  const a = {
      ...f.branch("混合组", [f.people[0], f.people[1]]),
      entrants: [
        {
          participantId: f.people[1],
          at: "meeting" as const,
          arrivalMinutes: 630,
        },
      ],
    },
    b = f.branch("其他组", [f.people[2]]);
  const saved = f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    2,
    {
      departures: [
        {
          branchId: a.id,
          source: {
            kind: "place",
            place: { title: "酒店出发", lat: 22, lng: 114 },
          },
        },
        {
          branchId: b.id,
          source: {
            kind: "place",
            place: { title: "机场出发", lat: 22.1, lng: 114.1 },
          },
        },
      ],
    },
  );
  f.manual();
  const days = f.days(),
    times = calculateTripTimelines(days, f.people[1]),
    entry = times.get(f.ids[2])!.entries.find((e) => e.itemId === meet)!;
  expect(entry).toMatchObject({
    arrival: 630 * 60,
    start: 630 * 60,
    lateMinutes: 30,
  });
  const own = itineraryDays(
    days,
    s.snapshot(f.id, actor).participants,
    f.people[1],
  );
  expect(
    own
      .flatMap((day) => day.stops)
      .some((stop) => stop.id === early || stop.title === "酒店出发"),
  ).toBe(false);
  expect(own[2].stops.some((stop) => stop.id === later)).toBe(true);
  const section = days[2].items.find((i) => i.id === saved.id)!;
  const origin = section.parallelPlan!.branches[0].departureItemId!;
  const personal = participantDay(
    contextualDays(days)[2],
    f.people[1],
    times.get(f.ids[2]),
  );
  expect(personal.items.some((item) => item.id === origin)).toBe(false);
  expect(personal.legs.some((leg) => leg.fromItemId === origin)).toBe(false);
});
it("supports joining at an inherited shared departure without attending earlier activities", () => {
  const f = setup(),
    before = f.item("之前的活动", 2),
    shared = f.item("会合酒店", 2, {
      fixedTime: true,
      startMinutes: 540,
      endMinutes: 570,
    }),
    meet = f.item("游艇会", 2, { fixedTime: true, startMinutes: 660 });
  const a = {
      ...f.branch("同车组", [f.people[0], f.people[1]]),
      entrants: [{ participantId: f.people[1], at: "departure" as const }],
    },
    b = f.branch("另一组", [f.people[2]]);
  f.save({
    splitItemId: shared,
    joinItemId: meet,
    joinPolicy: "wait_all",
    branches: [a, b],
  });
  f.manual();
  const own = itineraryDays(
    f.days(),
    s.snapshot(f.id, actor).participants,
    f.people[1],
  );
  expect(own[2].stops.some((item) => item.id === before)).toBe(false);
  expect(own[2].stops.some((item) => item.id === meet)).toBe(true);
  expect(
    f
      .days()[2]
      .legs.some(
        (leg) =>
          leg.branchId === a.id &&
          leg.fromItemId === shared &&
          leg.toItemId === meet,
      ),
  ).toBe(true);
});
it("keeps ungrouped existing travelers' earlier plans when other people only join later", () => {
  const f = setup(),
    first = f.item("原有首日活动"),
    meet = f.item("第三日会合", 2, { fixedTime: true, startMinutes: 600 });
  const branches = f.people.slice(1).map((id, i) => ({
    ...f.branch(`新到${i}组`, [id]),
    entrants: [
      {
        participantId: id,
        at: "meeting" as const,
        arrivalMinutes: 600 + i * 30,
      },
    ],
  }));
  f.save({
    splitItemId: null,
    joinItemId: meet,
    joinPolicy: "wait_all",
    branches,
  });
  const times = calculateTripTimelines(f.days());
  expect(
    times.get(f.ids[0])!.entries.find((entry) => entry.itemId === first)?.start,
  ).toBe(480 * 60);
  expect(
    times.get(f.ids[2])!.entries.find((entry) => entry.itemId === meet)?.start,
  ).toBe(630 * 60);
});
it("keeps an origin-stage entrant out of earlier dates even when the section starts before its origin", () => {
  const f = setup(),
    first = f.item("首日安排"),
    meet = f.item("第三日会合", 2, { fixedTime: true, startMinutes: 720 });
  const a = f.branch("先行组", [f.people[0]]),
    b = {
      ...f.branch("第三天加入", [f.people[1]]),
      startMinutes: 2 * 1440 + 540,
      entrants: [{ participantId: f.people[1], at: "departure" as const }],
    };
  f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    0,
    {
      departures: [
        {
          branchId: a.id,
          source: {
            kind: "place",
            place: { title: "原起点", lat: 22, lng: 114 },
          },
        },
        {
          branchId: b.id,
          dayId: f.ids[2],
          source: {
            kind: "place",
            place: { title: "第三天车站", lat: 22.1, lng: 114.1 },
          },
        },
      ],
    },
  );
  f.manual();
  const own = itineraryDays(
    f.days(),
    s.snapshot(f.id, actor).participants,
    f.people[1],
  );
  expect(own[0].stops).toEqual([]);
  expect(own[1].stops).toEqual([]);
  expect(
    own.flatMap((day) => day.stops).some((stop) => stop.id === first),
  ).toBe(false);
  expect(own[2].stops.find((stop) => stop.title === "第三天车站")?.time).toBe(
    "09:00",
  );
});
it("remaps explicit origins and mid-trip participants in portable files and section copies", () => {
  const f = setup(),
    meet = f.item("集合", 0, { fixedTime: true, startMinutes: 600 });
  const branches = [
    f.branch("甲", [f.people[0]]),
    {
      ...f.branch("乙", [f.people[1]]),
      entrants: [
        {
          participantId: f.people[1],
          at: "meeting" as const,
          arrivalMinutes: 600,
        },
      ],
    },
  ];
  const saved = f.save(
    { splitItemId: null, joinItemId: meet, joinPolicy: "wait_all", branches },
    0,
    {
      departures: [
        {
          branchId: branches[0].id,
          source: {
            kind: "place",
            place: { title: "甲起点", lat: 22, lng: 114 },
          },
        },
      ],
    },
  );
  const file = files.exportTripFile(f.id, actor);
  expect(file.version).toBe(4);
  const imported = files.importTripFile(actor, file),
    restored = core.getDays(imported.id);
  const section = restored[0].items.find((i) => i.parallelPlan)!;
  expect(
    restored[0].items.some(
      (i) => i.id === section.parallelPlan!.branches[0].departureItemId,
    ),
  ).toBe(true);
  expect(section.parallelPlan!.branches[1].entrants?.[0].participantId).toBe(
    section.parallelPlan!.branches[1].participantIds[0],
  );
  const copied = bulk.transferParallel(f.id, actor, {
    sectionId: saved.id,
    operation: "copy",
    targetDayId: f.ids[1],
    expectedDays: f.versions(),
  });
  const clone = f.days()[1].items.find((i) => i.id === copied.id)!;
  expect(
    f
      .days()[1]
      .items.some(
        (i) => i.id === clone.parallelPlan!.branches[0].departureItemId,
      ),
  ).toBe(true);
});
it("rejects foreign origins and invalid participation members without partial writes", () => {
  const f = setup(),
    other = setup(),
    foreign = places.savePoolPlace(other.id, actor, { title: "别的行程地点" });
  const branches = [
    f.branch("甲", [f.people[0]]),
    f.branch("乙", [f.people[1]]),
  ];
  const before = f.days();
  expect(() =>
    f.save(
      { splitItemId: null, joinItemId: null, joinPolicy: "wait_all", branches },
      0,
      {
        departures: [
          {
            branchId: branches[0].id,
            source: { kind: "pool", placeId: foreign.id },
          },
        ],
      },
    ),
  ).toThrow("地点池");
  expect(f.days()).toEqual(before);
  expect(() =>
    f.save(
      {
        splitItemId: null,
        joinItemId: null,
        joinPolicy: "wait_all",
        branches: [
          {
            ...branches[0],
            entrants: [{ participantId: f.people[2], at: "departure" }],
          },
          branches[1],
        ],
      },
      0,
    ),
  ).toThrow("本组成员");
  expect(f.days()).toEqual(before);
});

it("copies a location from another arrangement without moving the original, and validates an explicit own origin", () => {
  const f = setup(),
    source = f.item("早前酒店", 0),
    meet = f.item("第三天集合", 2, { fixedTime: true, startMinutes: 600 });
  const branches = [
    f.branch("甲", [f.people[0]]),
    f.branch("乙", [f.people[1]]),
  ];
  const saved = f.save(
    { splitItemId: null, joinItemId: meet, joinPolicy: "wait_all", branches },
    2,
    {
      departures: [
        {
          branchId: branches[0].id,
          dayId: f.ids[2],
          source: { kind: "item", itemId: source },
        },
      ],
    },
  );
  const original = f.days()[0].items.find((i) => i.id === source)!;
  expect(original.branchId).toBeNull();
  const section = f.days()[2].items.find((i) => i.id === saved.id)!,
    origin = section.parallelPlan!.branches[0].departureItemId!;
  expect(origin).not.toBe(source);
  expect(f.days()[2].items.find((i) => i.id === origin)?.title).toBe(
    "早前酒店",
  );
  const before = f.days();
  expect(() =>
    s.editItem(origin, actor, {
      expectedVersion: f.days()[2].items.find((i) => i.id === origin)!.version,
      branchId: branches[1].id,
    }),
  ).toThrow("出发地点");
  expect(f.days()).toEqual(before);
});

it("supports joining from an independent origin in the second week", () => {
  const f = setup("2026-10-12"),
    meet = f.item("第十天集合", 9, { fixedTime: true, startMinutes: 720 });
  const a = f.branch("全程组", [f.people[0]]),
    b = {
      ...f.branch("后来加入", [f.people[1]]),
      startMinutes: 9 * 1440 + 540,
      entrants: [{ participantId: f.people[1], at: "departure" as const }],
    };
  f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    0,
    {
      departures: [
        {
          branchId: a.id,
          source: {
            kind: "place",
            place: { title: "前期起点", lat: 22, lng: 114 },
          },
        },
        {
          branchId: b.id,
          dayId: f.ids[9],
          source: {
            kind: "place",
            place: { title: "第十天车站", lat: 22.1, lng: 114.1 },
          },
        },
      ],
    },
  );
  f.manual();
  const own = itineraryDays(
    f.days(),
    s.snapshot(f.id, actor).participants,
    f.people[1],
  );
  expect(own.slice(0, 9).every((day) => day.stops.length === 0)).toBe(true);
  expect(own[9].stops.find((stop) => stop.title === "第十天车站")?.time).toBe(
    "09:00",
  );
});

it("does not let an admission rule hide conflicting group assignments after the person joins", () => {
  const f = setup("2026-10-06"),
    meet = f.item("第五天集合", 4),
    later = f.item("第六天集合", 5);
  const a = {
      ...f.branch("第三天加入", [f.people[0]]),
      entrants: [{ participantId: f.people[0], at: "departure" as const }],
    },
    b = f.branch("原有分组", [f.people[1]]);
  f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    0,
    {
      departures: [
        {
          branchId: a.id,
          dayId: f.ids[2],
          source: {
            kind: "place",
            place: { title: "第三天出发", lat: 22, lng: 114 },
          },
        },
      ],
    },
  );
  const before = f.days();
  expect(() =>
    s.createItem(f.ids[3], actor, {
      title: "中间重叠分组",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: later,
        joinPolicy: "wait_all",
        branches: [
          f.branch("重叠甲", [f.people[0]]),
          f.branch("重叠乙", [f.people[2]]),
        ],
      },
    }),
  ).toThrow("时间范围重叠");
  expect(f.days()).toEqual(before);
});

it("preserves direct-meeting participation when the section is copied to a later day", () => {
  const f = setup(),
    meet = f.item("一起集合", 0, { fixedTime: true, startMinutes: 600 });
  const a = {
      ...f.branch("混合组", [f.people[0], f.people[1]]),
      entrants: [
        {
          participantId: f.people[1],
          at: "meeting" as const,
          arrivalMinutes: 600,
        },
      ],
    },
    b = f.branch("另一组", [f.people[2]]);
  const saved = f.save(
    {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [a, b],
    },
    0,
    {
      departures: [
        {
          branchId: a.id,
          source: {
            kind: "place",
            place: { title: "同行者的酒店", lat: 22, lng: 114 },
          },
        },
      ],
    },
  );
  const origin = f.days()[0].items.find((item) => item.id === saved.id)!
    .parallelPlan!.branches[0].departureItemId!;
  s.createItem(f.ids[0], actor, {
    title: "加入前的组内活动",
    type: "parallel",
    branchId: a.id,
    parallelPlan: {
      splitItemId: origin,
      joinItemId: null,
      joinPolicy: "wait_all",
      branches: [
        f.branch("子组甲", [f.people[0]]),
        f.branch("子组乙", [f.people[1]]),
      ],
    },
  });
  const copied = bulk.transferParallel(f.id, actor, {
    sectionId: saved.id,
    operation: "copy",
    targetDayId: f.ids[1],
    expectedDays: f.versions(),
  });
  const section = f.days()[1].items.find((item) => item.id === copied.id)!;
  const own = itineraryDays(
    f.days(),
    s.snapshot(f.id, actor).participants,
    f.people[1],
  );
  expect(
    own[1].stops.some(
      (stop) => stop.id === section.parallelPlan!.branches[0].departureItemId,
    ),
  ).toBe(false);
  expect(
    own[1].stops.some((stop) => stop.id === section.parallelPlan!.joinItemId),
  ).toBe(true);
});
