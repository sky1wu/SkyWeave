import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const directory = mkdtempSync(`${tmpdir()}/trip-sharing-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const sharing = await import("@/server/itinerary-share-service");
const { insert, many, sqlite } = await import("@/server/db");
const owner = { id: "share-owner", name: "Owner", email: "owner@example.test" };
const editor = {
  id: "share-editor",
  name: "Editor",
  email: "editor@example.test",
};
const viewer = {
  id: "share-viewer",
  name: "Viewer",
  email: "viewer@example.test",
};
const outsider = {
  id: "share-outsider",
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

describe("public itinerary sharing", () => {
  it("reuses the active link, revokes it permanently, and protects a new link from stale cancellation", () => {
    const trip = s.createTrip(owner, { title: "可取消的分享" });
    expect(sharing.getItineraryShare(trip.id, owner)).toEqual({ share: null });
    const { share } = sharing.createItineraryShare(trip.id, owner);
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sharing.createItineraryShare(trip.id, owner).share).toEqual(share);
    expect(sharing.getItineraryShare(trip.id, owner).share).toEqual(share);
    expect(sharing.sharedItinerary(share.token).title).toBe("可取消的分享");
    sharing.revokeItineraryShare(trip.id, share.id, owner);
    expect(sharing.getItineraryShare(trip.id, owner).share).toBeNull();
    expect(() => sharing.sharedItinerary(share.token)).toThrow(
      "分享链接已取消或不存在",
    );
    const next = sharing.createItineraryShare(trip.id, owner).share;
    expect(next.token).not.toBe(share.token);
    sharing.revokeItineraryShare(trip.id, share.id, owner);
    expect(sharing.sharedItinerary(next.token).title).toBe("可取消的分享");
    expect(() => sharing.sharedItinerary(share.token)).toThrow();
    expect(
      many("SELECT * FROM itinerary_shares WHERE tripId=?", trip.id),
    ).toHaveLength(1);
    expect(JSON.stringify(s.snapshot(trip.id, owner))).not.toContain(
      next.token,
    );
  });

  it("allows only the active owner to manage sharing and isolates trips", () => {
    const trip = s.createTrip(owner, { title: "分享权限" });
    for (const [actor, role] of [
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const)
      s.joinInvite(s.createInvite(trip.id, owner, { role }).token, actor);
    const { share } = sharing.createItineraryShare(trip.id, owner);
    for (const actor of [editor, viewer, outsider]) {
      expect(() => sharing.getItineraryShare(trip.id, actor)).toThrow();
      expect(() => sharing.createItineraryShare(trip.id, actor)).toThrow();
      expect(() =>
        sharing.revokeItineraryShare(trip.id, share.id, actor),
      ).toThrow();
    }
    const other = s.createTrip(owner, { title: "另一行程" });
    sharing.revokeItineraryShare(other.id, share.id, owner);
    expect(sharing.sharedItinerary(share.token).title).toBe("分享权限");
    sqlite
      .prepare(
        "UPDATE trip_members SET status='inactive' WHERE tripId=? AND userId=?",
      )
      .run(trip.id, owner.id);
    expect(() => sharing.createItineraryShare(trip.id, owner)).toThrow();
    expect(() =>
      sharing.revokeItineraryShare(trip.id, share.id, owner),
    ).toThrow();
  });

  it("returns only handbook fields, uses current plans, and does not create members", () => {
    const trip = s.createTrip(owner, {
      title: "公开手册",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
    });
    const snapshot = s.snapshot(trip.id, owner);
    const item = s.createItem(snapshot.days[0].id, owner, {
      type: "note",
      title: "集合安排",
      description: "公开说明",
      notes: "公开备注",
    });
    s.createParticipant(trip.id, owner, { name: "不公开的成员姓名" });
    s.addComment(trip.id, owner, {
      targetType: "trip",
      targetId: trip.id,
      content: "不公开的内部评论",
    });
    s.saveExpense(trip.id, owner, {
      title: "不公开的账目",
      category: "food",
      amountMinor: 100,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: snapshot.participants[0].id,
      splitMethod: "equal",
      splitMeta: [{ participantId: snapshot.participants[0].id, value: "1" }],
      incurredAt: Date.now(),
    });
    const { share } = sharing.createItineraryShare(trip.id, owner);
    const publicData = sharing.sharedItinerary(share.token);
    expect(Object.keys(publicData).sort()).toEqual([
      "dates",
      "days",
      "timezone",
      "title",
    ]);
    expect(publicData.days).toHaveLength(2);
    expect(publicData.days[0].stops[0].details.map((d) => d.text)).toEqual([
      "公开说明",
      "公开备注",
    ]);
    const json = JSON.stringify(publicData);
    for (const privateValue of [
      owner.id,
      owner.email,
      "不公开的成员姓名",
      "不公开的内部评论",
      "不公开的账目",
      "updatedByUserId",
      "createdByUserId",
      "poolPlaces",
      "participants",
      "expenses",
      "activity",
      "invites",
    ])
      expect(json).not.toContain(privateValue);
    s.editItem(item.id, owner, {
      expectedVersion: 1,
      title: "更新后的集合安排",
    });
    expect(sharing.sharedItinerary(share.token).days[0].stops[0].title).toBe(
      "更新后的集合安排",
    );
    expect(s.snapshot(trip.id, owner).members).toHaveLength(1);
  });

  it("rejects malformed, unknown and deleted-trip links", () => {
    for (const token of [
      "",
      "short",
      "x".repeat(43),
      "' OR 1=1 --",
      "a".repeat(1000),
    ])
      expect(() => sharing.sharedItinerary(token)).toThrow(
        "分享链接已取消或不存在",
      );
    const trip = s.createTrip(owner, { title: "删除的行程" });
    const { share } = sharing.createItineraryShare(trip.id, owner);
    s.deleteTrip(trip.id, owner, 1);
    expect(() => sharing.sharedItinerary(share.token)).toThrow(
      "分享链接已取消或不存在",
    );
    expect(
      many("SELECT * FROM itinerary_shares WHERE tripId=?", trip.id),
    ).toHaveLength(0);
  });
});
