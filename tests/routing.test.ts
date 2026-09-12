import { it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/trip-routing-`)}/test.sqlite`;
process.env.AMAP_TEST_MODE = "1";
const s = await import("@/server/service");
const { insert } = await import("@/server/db");
const { calculateLeg, calculateDay } = await import("@/server/routing");
const { amap } = await import("@/amap/service");
const { mockRoutes } = await import("@/amap/test-provider");
const actor = {
  id: "route-user",
  name: "Route user",
  email: "route@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
function setup() {
  const trip = s.createTrip(actor, { title: "路线", startDate: "2026-10-02" });
  const day = s.snapshot(trip.id, actor).days[0];
  s.createItem(day.id, actor, { title: "A", lat: 22.3, lng: 114.1 });
  s.createItem(day.id, actor, { title: "B", lat: 22.4, lng: 114.2 });
  return s.getDay(day.id);
}
it("discards delayed results after an item changes", async () => {
  const day = setup();
  let release: (
    routes: Awaited<ReturnType<typeof amap.routes>>,
  ) => void = () => {};
  const spy = vi.spyOn(amap, "routes").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const task = calculateLeg(day.legs[0].id, actor);
  const rejection = expect(task).rejects.toMatchObject({ status: 409 });
  s.editItem(day.items[0].id, actor, { expectedVersion: 1, lat: 22.31 });
  release(
    mockRoutes({
      mode: "transit",
      origin: { lat: 22.3, lng: 114.1 },
      destination: { lat: 22.4, lng: 114.2 },
    }),
  );
  await rejection;
  expect(s.getDay(day.id).legs[0].alternatives).toHaveLength(0);
  spy.mockRestore();
});
it("selects the recommended route then preserves a user choice when refreshed", async () => {
  const day = setup();
  await calculateDay(day.id, actor);
  let leg = s.getDay(day.id).legs[0];
  expect(leg.alternatives).toHaveLength(3);
  expect(leg.selectedAlternativeId).toBe(leg.alternatives[0].id);
  s.editLeg(leg.id, actor, {
    expectedVersion: leg.version,
    selectedAlternativeId: leg.alternatives[1].id,
  });
  await calculateLeg(leg.id, actor, true);
  leg = s.getDay(day.id).legs[0];
  expect(leg.selectedAlternativeId).toBe(leg.alternatives[1].id);
  expect(leg.selectionSource).toBe("user");
});
