import { describe, expect, it, vi } from "vitest";
import { TripStore } from "@/lib/trip-store";
import { api, ApiFailure } from "@/lib/client";
import type { DayPlan, VersionedSnapshot } from "@/domain/types";

const snapshot = (sequence: number) =>
  ({
    sequence,
    trip: { id: "trip" },
    members: [],
    comments: [],
    activity: [],
  }) as unknown as VersionedSnapshot;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("trip workspace synchronization", () => {
  it.each(["focus", "navigation"])(
    "refreshes member names on %s even when Better Auth edits produce no trip event",
    async (trigger) => {
      const initial = {
        ...snapshot(1),
        members: [
          { userId: "user", name: "Old name", email: "old@example.test" },
        ],
      } as VersionedSnapshot;
      const request = vi
        .fn<typeof api>()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce({
          sequence: 1,
          members: [
            { userId: "user", name: "New name", email: "new@example.test" },
          ],
        });
      const store = new TripStore("trip", request as typeof api);
      await store.activate("members");
      await (trigger === "focus"
        ? store.checkRevision()
        : store.activate("members"));
      expect(store.get("members").data?.members[0].name).toBe("New name");
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it("uses the initial response when SSE sync arrives during its download", async () => {
    const first = deferred<VersionedSnapshot>();
    const request = vi.fn<typeof api>().mockReturnValue(first.promise);
    const store = new TripStore("trip", request as typeof api);
    const loading = store.activate("expenses");
    expect(store.sync(4)).toBe(loading);
    first.resolve(snapshot(4));
    await loading;
    await store.sync(4);
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.get("expenses").data?.sequence).toBe(4);
  });

  it("keeps an early response usable and catches changes made while it was downloading", async () => {
    const first = deferred<VersionedSnapshot>();
    const next = deferred<VersionedSnapshot>();
    const request = vi
      .fn<typeof api>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise);
    const store = new TripStore("trip", request as typeof api);
    const loading = store.activate("plan");
    void store.sync(5);
    void store.sync(6);
    first.resolve(snapshot(4));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(store.get("plan").data?.sequence).toBe(4);
    next.resolve(snapshot(6));
    await loading;
    expect(store.get("plan").data?.sequence).toBe(6);
  });

  it("does not repeat a read that already contains the announced change", async () => {
    const first = deferred<VersionedSnapshot>();
    const request = vi.fn<typeof api>().mockReturnValueOnce(first.promise);
    const store = new TripStore("trip", request as typeof api);
    const loading = store.activate("plan");
    void store.sync(7);
    first.resolve(snapshot(8));
    await loading;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads again after a mutation finishes during an older request, without relying on SSE", async () => {
    const first = deferred<VersionedSnapshot>();
    const request = vi
      .fn<typeof api>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(snapshot(2));
    const store = new TripStore("trip", request as typeof api);
    const loading = store.activate("expenses");
    expect(store.refresh("expenses")).toBe(loading);
    first.resolve(snapshot(1));
    await loading;
    await store.sync(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.get("expenses").data?.sequence).toBe(2);
  });

  it("reuses cached sections and invalidates them when a collaborator edits the trip", async () => {
    const request = vi.fn<typeof api>().mockResolvedValue(snapshot(1));
    const store = new TripStore("trip", request as typeof api);
    await store.activate("plan");
    await store.activate("members");
    await store.activate("plan");
    const snapshotCalls = () =>
      request.mock.calls.filter(([path]) => path.includes("?section="));
    expect(snapshotCalls()).toHaveLength(2);
    request.mockResolvedValue(snapshot(2));
    await store.sync(2);
    expect(snapshotCalls()).toHaveLength(3);
    await store.activate("members");
    expect(snapshotCalls()).toHaveLength(4);
    expect(store.get("members").data?.sequence).toBe(2);
  });

  it("coalesces focus checks and avoids downloading unchanged snapshots", async () => {
    const revision = deferred<{ sequence: number }>();
    const request = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(snapshot(1))
      .mockReturnValueOnce(revision.promise);
    const store = new TripStore("trip", request as typeof api);
    await store.activate("expenses");
    const checking = store.checkRevision();
    expect(store.checkRevision()).toBe(checking);
    revision.resolve({ sequence: 1 });
    await checking;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/trips/trip/revision");
  });

  it("aborts and clears all private state on revocation, including late responses", async () => {
    const late = deferred<VersionedSnapshot>();
    const request = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(snapshot(1))
      .mockReturnValueOnce(late.promise);
    const store = new TripStore("trip", request as typeof api);
    await store.activate("plan");
    const loading = store.activate("expenses");
    const signal = request.mock.calls[1][3]!.signal!;
    store.revoke();
    expect(signal.aborted).toBe(true);
    late.resolve(snapshot(2));
    await loading;
    for (const section of ["plan", "expenses", "members"] as const) {
      expect(store.get(section).data).toBeNull();
      expect(store.get(section).error).toContain("权限");
    }
    await store.activate("members");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("clears cached sections when a reconnect discovers an expired session", async () => {
    const request = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(snapshot(1))
      .mockRejectedValueOnce(new ApiFailure(401, "UNAUTHORIZED", "请先登录"));
    const store = new TripStore("trip", request as typeof api);
    await store.activate("plan");
    await expect(store.checkRevision()).rejects.toThrow("请先登录");
    expect(store.get("plan").data).toBeNull();
    expect(store.isRevoked()).toBe(true);
  });

  it("allows a fresh request after effect cleanup without restoring the cancelled result", async () => {
    const old = deferred<VersionedSnapshot>();
    const request = vi
      .fn<typeof api>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(snapshot(2));
    const store = new TripStore("trip", request as typeof api);
    const loading = store.activate("plan");
    store.cancel();
    await store.activate("plan");
    old.resolve(snapshot(1));
    await loading;
    expect(store.get("plan").data?.sequence).toBe(2);
  });

  it("caches geometry by day version and never replaces newer geometry with a late response", async () => {
    const old = deferred<unknown>();
    const request = vi
      .fn<typeof api>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ dayId: "day", version: 2, alternatives: [] });
    const store = new TripStore("trip", request as typeof api);
    const day = { id: "day", version: 1 } as DayPlan;
    const first = store.geometry(day);
    expect(store.geometry(day)).toBe(first);
    await store.geometry({ ...day, version: 2 });
    old.resolve({ dayId: "day", version: 1, alternatives: [] });
    await first;
    expect((await store.geometry({ ...day, version: 2 })).version).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
