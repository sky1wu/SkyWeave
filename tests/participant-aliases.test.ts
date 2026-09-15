import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const directory = mkdtempSync(`${tmpdir()}/participant-aliases-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const { listParticipantAliases: list, saveParticipantAlias: save } =
  await import("@/server/participant-alias-service");
const { exportTripFile } = await import("@/server/trip-file-service");
const { createItineraryShare, sharedItinerary } =
  await import("@/server/itinerary-share-service");
const { insert, many, sqlite } = await import("@/server/db");
const owner = { id: "owner", name: "Owner", email: "owner@example.test" };
const editor = { id: "editor", name: "Editor", email: "editor@example.test" };
const viewer = { id: "viewer", name: "Viewer", email: "viewer@example.test" };
const outsider = {
  id: "outsider",
  name: "Outsider",
  email: "outsider@example.test",
};

beforeAll(() => {
  for (const actor of [owner, editor, viewer, outsider])
    insert("users", { ...actor, createdAt: Date.now(), updatedAt: Date.now() });
});
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const trip = s.createTrip(owner, { title: "私人备注名" });
  for (const [actor, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    s.joinInvite(s.createInvite(trip.id, owner, { role }).token, actor);
  const participant = s
    .snapshot(trip.id, owner)
    .participants.find((p) => p.userId === editor.id)!;
  return { tripId: trip.id, participantId: participant.id };
}

describe("personal participant aliases", () => {
  it("isolates every member's aliases, including viewers, without changing shared data or exports", () => {
    const { tripId, participantId } = fixture();
    const share = createItineraryShare(tripId, owner).share;
    const before = s.snapshot(tripId, owner);
    for (const actor of [owner, editor, viewer]) {
      expect(list(tripId, actor)).toEqual([]);
      const name = `private-${actor.id}`;
      expect(
        save(tripId, participantId, actor, {
          name: ` ${name} `,
          expectedVersion: 0,
        }),
      ).toEqual({ participantId, name, version: 1 });
    }
    for (const actor of [owner, editor, viewer]) {
      expect(list(tripId, actor)).toEqual([
        { participantId, name: `private-${actor.id}`, version: 1 },
      ]);
      expect(JSON.stringify(s.snapshot(tripId, actor))).not.toContain(
        "private-",
      );
      expect(JSON.stringify(exportTripFile(tripId, actor))).not.toContain(
        "private-",
      );
    }
    expect(s.snapshot(tripId, owner)).toEqual(before);
    expect(JSON.stringify(sharedItinerary(share.token))).not.toContain(
      "private-",
    );
  });

  it("rejects stale writes before and after clearing, leaving other users' aliases intact", () => {
    const { tripId, participantId } = fixture();
    save(tripId, participantId, owner, {
      name: "自己的称呼",
      expectedVersion: 0,
    });
    save(tripId, participantId, viewer, {
      name: "另一人的称呼",
      expectedVersion: 0,
    });
    expect(() =>
      save(tripId, participantId, owner, {
        name: "过期修改",
        expectedVersion: 0,
      }),
    ).toThrow("其他页面");
    expect(
      save(tripId, participantId, owner, { name: "   ", expectedVersion: 1 }),
    ).toEqual({ participantId, name: "", version: 2 });
    for (const expectedVersion of [0, 1])
      expect(() =>
        save(tripId, participantId, owner, {
          name: "过期修改",
          expectedVersion,
        }),
      ).toThrow("其他页面");
    expect(list(tripId, viewer)[0].name).toBe("另一人的称呼");
    expect(
      save(tripId, participantId, owner, { name: "新称呼", expectedVersion: 2 })
        .version,
    ).toBe(3);
  });

  it("validates trip access, participant ownership, input and caller identity", () => {
    const { tripId, participantId } = fixture();
    const other = s.createTrip(owner, { title: "另一行程" });
    expect(() => list(tripId, outsider)).toThrow("访问权限");
    expect(() =>
      save(tripId, participantId, outsider, {
        name: "越权",
        expectedVersion: 0,
      }),
    ).toThrow("访问权限");
    expect(() =>
      save(other.id, participantId, owner, {
        name: "串行程",
        expectedVersion: 0,
      }),
    ).toThrow("不存在");
    expect(() =>
      save(tripId, "missing", owner, { name: "错误成员", expectedVersion: 0 }),
    ).toThrow("不存在");
    for (const body of [
      { name: "越权", expectedVersion: 0, userId: viewer.id },
      { name: "x".repeat(101), expectedVersion: 0 },
      { name: null, expectedVersion: 0 },
      { name: "无版本" },
      { name: "负版本", expectedVersion: -1 },
    ])
      expect(() => save(tripId, participantId, owner, body)).toThrow();
    expect(list(tripId, owner)).toEqual([]);
    save(tripId, participantId, viewer, {
      name: "移出前备注",
      expectedVersion: 0,
    });
    s.editMember(tripId, viewer.id, owner, {
      status: "inactive",
      expectedVersion: 1,
    });
    expect(() => list(tripId, viewer)).toThrow("访问权限");
    expect(() =>
      save(tripId, participantId, viewer, {
        name: "移出后备注",
        expectedVersion: 1,
      }),
    ).toThrow("访问权限");
  });

  it("preserves a guest's alias when they bind an account and removes aliases with deleted participants or trips", () => {
    const { tripId } = fixture();
    const guest = s.createParticipant(tripId, owner, { name: "原同行者姓名" });
    save(tripId, guest.id, viewer, {
      name: "我熟悉的称呼",
      expectedVersion: 0,
    });
    s.joinInvite(
      s.createInvite(tripId, owner, { participantId: guest.id }).token,
      outsider,
    );
    expect(list(tripId, viewer)).toEqual([
      { participantId: guest.id, name: "我熟悉的称呼", version: 1 },
    ]);
    expect(list(tripId, outsider)).toEqual([]);
    const removable = s.createParticipant(tripId, owner, {
      name: "临时同行者",
    });
    save(tripId, removable.id, owner, { name: "临时备注", expectedVersion: 0 });
    save(tripId, removable.id, viewer, {
      name: "其他临时备注",
      expectedVersion: 0,
    });
    s.deleteParticipant(tripId, removable.id, owner, 1);
    expect(
      many(
        "SELECT * FROM participant_aliases WHERE participantId=?",
        removable.id,
      ),
    ).toEqual([]);
    s.deleteTrip(tripId, owner, 1);
    expect(
      many("SELECT * FROM participant_aliases WHERE participantId=?", guest.id),
    ).toEqual([]);
  });
});
