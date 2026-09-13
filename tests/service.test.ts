import { beforeAll, describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/trip-service-`)}/test.sqlite`;
const s = await import("@/server/service");
const { insert, one } = await import("@/server/db");
const a = { id: "a", name: "Alice", email: "a@example.test" },
  b = { id: "b", name: "Bob", email: "b@example.test" },
  c = { id: "c", name: "Carol", email: "c@example.test" };
beforeAll(() => {
  for (const u of [a, b, c])
    insert("users", { ...u, createdAt: Date.now(), updatedAt: Date.now() });
});
describe("collaborative trip transactions", () => {
  it.each(["active", "inactive"] as const)(
    "deletes an %s guest and their dedicated invites without affecting other people",
    (status) => {
      const trip = s.createTrip(a, { title: "删除同行者" });
      const guest = s.createParticipant(trip.id, a, { name: "误添加的同行者" });
      const other = s.createParticipant(trip.id, a, { name: "保留的同行者" });
      const invite = s.createInvite(trip.id, a, { participantId: guest.id });
      const revoked = s.createInvite(trip.id, a, { participantId: guest.id });
      s.revokeInvite(trip.id, revoked.id, a, 1);
      const general = s.createInvite(trip.id, a, {});
      const otherInvite = s.createInvite(trip.id, a, {
        participantId: other.id,
      });
      if (status === "inactive")
        s.editParticipant(trip.id, guest.id, a, {
          expectedVersion: 1,
          status,
        });

      expect(
        s.deleteParticipant(trip.id, guest.id, a, status === "active" ? 1 : 2),
      ).toEqual({ deleted: true });
      const after = s.snapshot(trip.id, a);
      expect(after.participants.map((p) => p.id)).not.toContain(guest.id);
      expect(after.participants).toHaveLength(2);
      expect(after.participants.map((p) => p.id)).toContain(other.id);
      expect(after.invites.map((i) => i.id).sort()).toEqual(
        [general.id, otherInvite.id].sort(),
      );
      expect(() => s.joinInvite(invite.token, b)).toThrow("邀请无效");
      expect(() => s.joinInvite(revoked.token, b)).toThrow("邀请无效");
      expect(after.activity).toContainEqual(
        expect.objectContaining({
          entityType: "participant",
          entityId: guest.id,
          summary: "删除了同行者「误添加的同行者」",
        }),
      );
    },
  );
  it("restricts guest deletion to the owner, current version, and matching trip", () => {
    const trip = s.createTrip(a, { title: "删除权限" });
    s.joinInvite(s.createInvite(trip.id, a, { role: "editor" }).token, b);
    s.joinInvite(s.createInvite(trip.id, a, { role: "viewer" }).token, c);
    const guest = s.createParticipant(trip.id, b, { name: "同行者" });
    const invite = s.createInvite(trip.id, a, { participantId: guest.id });
    for (const actor of [b, c])
      expect(() => s.deleteParticipant(trip.id, guest.id, actor, 1)).toThrow(
        "权限",
      );
    const otherTrip = s.createTrip(a, { title: "其他行程" });
    expect(() => s.deleteParticipant(otherTrip.id, guest.id, a, 1)).toThrow();
    s.editParticipant(trip.id, guest.id, a, {
      expectedVersion: 1,
      name: "已修改",
    });
    expect(() => s.deleteParticipant(trip.id, guest.id, a, 1)).toThrow();
    const before = s.snapshot(trip.id, a);
    for (const participant of before.participants.filter((p) => p.userId))
      expect(() =>
        s.deleteParticipant(trip.id, participant.id, a, participant.version),
      ).toThrow("成员管理");
    expect(s.snapshot(trip.id, a)).toEqual(before);
    expect(before.invites.map((i) => i.id)).toContain(invite.id);
    s.deleteParticipant(trip.id, guest.id, a, 2);
  });
  it.each(["payer", "split", "sender", "recipient"] as const)(
    "preserves a guest referenced as a ledger %s, including invites and balances",
    (role) => {
      const trip = s.createTrip(a, { title: "保留历史账目" });
      const owner = s.snapshot(trip.id, a).participants[0];
      const guest = s.createParticipant(trip.id, a, { name: "有账目的同行者" });
      s.createInvite(trip.id, a, { participantId: guest.id });
      const expense = role === "payer" || role === "split";
      const record = expense
        ? s.saveExpense(trip.id, a, {
            title: "晚餐",
            category: "food",
            amountMinor: 100,
            currency: "CNY",
            exchangeRateToBase: "1",
            payerParticipantId: role === "payer" ? guest.id : owner.id,
            splitMethod: "equal",
            splitMeta: [
              {
                participantId: role === "split" ? guest.id : owner.id,
                value: "1",
              },
            ],
            incurredAt: Date.now(),
          })
        : s.createSettlement(trip.id, a, {
            fromParticipantId: role === "sender" ? guest.id : owner.id,
            toParticipantId: role === "recipient" ? guest.id : owner.id,
            amountMinor: 100,
            currency: "CNY",
            exchangeRateToBase: "1",
            settledAt: Date.now(),
          });
      const before = s.snapshot(trip.id, a);
      const balances = s.balances(trip.id, a);
      expect(() => s.deleteParticipant(trip.id, guest.id, a, 1)).toThrow(
        "请改用停用",
      );
      expect(s.snapshot(trip.id, a)).toEqual(before);
      expect(s.balances(trip.id, a)).toEqual(balances);
      if (expense) s.deleteExpense(record.id, a, 1);
      else s.deleteSettlement(record.id, a, 1);
      s.deleteParticipant(trip.id, guest.id, a, 1);
      expect(s.snapshot(trip.id, a).participants).toHaveLength(1);
    },
  );
  it("rejects expired and revoked invites without consuming a use", () => {
    const trip = s.createTrip(a, { title: "邀请有效期" });
    const now = Date.now();
    const expiring = s.createInvite(trip.id, a, { expiresAt: now + 1000 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    try {
      expect(() => s.joinInvite(expiring.token, b)).toThrow("过期");
    } finally {
      clock.mockRestore();
    }
    const revoked = s.createInvite(trip.id, a, {});
    s.revokeInvite(trip.id, revoked.id, a, 1);
    expect(() => s.joinInvite(revoked.token, b)).toThrow("撤销");
    expect(
      one<{ usedCount: number }>(
        "SELECT usedCount FROM trip_invites WHERE id=?",
        expiring.id,
      )?.usedCount,
    ).toBe(0);
  });
  it("allows only one claimant for a single-use invite under competing joins", async () => {
    const trip = s.createTrip(a, { title: "并发邀请" });
    const invite = s.createInvite(trip.id, a, { maxUses: 1 });
    const results = await Promise.allSettled(
      [b, c].map((actor) =>
        Promise.resolve().then(() => s.joinInvite(invite.token, actor)),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(s.snapshot(trip.id, a).members).toHaveLength(2);
    expect(
      one<{ usedCount: number }>(
        "SELECT usedCount FROM trip_invites WHERE id=?",
        invite.id,
      )?.usedCount,
    ).toBe(1);
  });
  it("binds a guest exactly once, retains their ledger identity, and prevents cross-trip access", () => {
    const trip = s.createTrip(a, { title: "香港", baseCurrency: "CNY" });
    const guest = s.createParticipant(trip.id, a, { name: "Bob（待加入）" });
    s.saveExpense(trip.id, a, {
      title: "绑定前已有费用",
      category: "food",
      amountMinor: 100,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: guest.id,
      splitMethod: "equal",
      splitMeta: [{ participantId: guest.id, value: "1" }],
      incurredAt: Date.now(),
    });
    const invite = s.createInvite(trip.id, a, {
      participantId: guest.id,
      role: "editor",
    });
    const stored = one<{ tokenHash: string }>(
      "SELECT tokenHash FROM trip_invites WHERE id=?",
      invite.id,
    )!;
    expect(stored.tokenHash).not.toBe(invite.token);
    expect(stored.tokenHash).toHaveLength(64);
    expect(s.joinInvite(invite.token, b).id).toBe(trip.id);
    const snap = s.snapshot(trip.id, b);
    expect(snap.participants.find((p) => p.userId === b.id)?.id).toBe(guest.id);
    expect(snap.expenses[0].payerParticipantId).toBe(guest.id);
    expect(snap.expenses[0].splits[0].participantId).toBe(guest.id);
    expect(() => s.joinInvite(invite.token, c)).toThrow();
    expect(() => s.snapshot(trip.id, c)).toThrow();
    const other = s.createTrip(a, { title: "另一个行程" });
    expect(() =>
      s.createInvite(other.id, a, { participantId: guest.id }),
    ).toThrow();
  });
  it("rejects stale edits, retains adjacent routes, and does not cascade-delete expenses", () => {
    const trip = s.createTrip(a, { title: "西安" });
    const day = s.snapshot(trip.id, a).days[0];
    const x = s.createItem(day.id, a, { title: "A", lat: 34, lng: 108 }),
      y = s.createItem(day.id, a, { title: "B", lat: 34.1, lng: 108.1 }),
      z = s.createItem(day.id, a, { title: "C", lat: 34.2, lng: 108.2 });
    const before = s.getDay(day.id);
    expect(before.legs).toHaveLength(2);
    s.editItem(x.id, a, { title: "A2", expectedVersion: 1 });
    expect(() =>
      s.editItem(x.id, a, { title: "Lost update", expectedVersion: 1 }),
    ).toThrow();
    expect(s.getDay(day.id).legs.map((l) => l.id)).toEqual(
      before.legs.map((l) => l.id),
    );
    const payer = s.snapshot(trip.id, a).participants[0];
    s.saveExpense(trip.id, a, {
      title: "门票",
      category: "ticket",
      amountMinor: 100,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: payer.id,
      splitMethod: "equal",
      splitMeta: [{ participantId: payer.id, value: "1" }],
      dayItemId: y.id,
      incurredAt: Date.now(),
    });
    s.deleteItem(y.id, a, 1);
    const after = s.snapshot(trip.id, a);
    expect(after.days[0].legs[0].fromItemId).toBe(x.id);
    expect(after.days[0].legs[0].toItemId).toBe(z.id);
    expect(after.expenses[0].dayItemId).toBeNull();
    expect(() =>
      s.editTrip(trip.id, a, { baseCurrency: "HKD", expectedVersion: 1 }),
    ).toThrow();
    s.deleteTrip(trip.id, a, after.trip.version);
    expect(() => s.snapshot(trip.id, a)).toThrow();
  });
  it("permits editor settlement, blocks viewers, and preserves removed member balances", () => {
    const trip = s.createTrip(a, { title: "共同费用", baseCurrency: "HKD" });
    s.joinInvite(s.createInvite(trip.id, a, { role: "editor" }).token, b);
    s.joinInvite(s.createInvite(trip.id, a, { role: "viewer" }).token, c);
    const snap = s.snapshot(trip.id, a),
      pa = snap.participants.find((p) => p.userId === "a")!,
      pb = snap.participants.find((p) => p.userId === "b")!;
    const expense = {
      title: "晚餐",
      category: "food",
      amountMinor: 60000,
      currency: "HKD",
      exchangeRateToBase: "1",
      payerParticipantId: pa.id,
      splitMethod: "equal",
      splitMeta: snap.participants.map((p) => ({
        participantId: p.id,
        value: "1",
      })),
      incurredAt: Date.now(),
    };
    expect(() => s.saveExpense(trip.id, c, expense)).toThrow();
    s.saveExpense(trip.id, b, expense);
    expect(
      s.balances(trip.id, a).balances.find((p) => p.participantId === pa.id)
        ?.net,
    ).toBe(40000);
    s.createSettlement(trip.id, b, {
      fromParticipantId: pb.id,
      toParticipantId: pa.id,
      amountMinor: 20000,
      currency: "HKD",
      exchangeRateToBase: "1",
      settledAt: Date.now(),
    });
    expect(
      s.balances(trip.id, a).balances.find((p) => p.participantId === pb.id)
        ?.net,
    ).toBe(0);
    s.editMember(trip.id, "b", a, { expectedVersion: 1, status: "inactive" });
    expect(() => s.snapshot(trip.id, b)).toThrow();
    expect(
      s.snapshot(trip.id, a).participants.find((p) => p.id === pb.id),
    ).toBeTruthy();
    s.addComment(trip.id, c, {
      targetType: "trip",
      targetId: trip.id,
      content: "这里集合",
    });
  });
});
