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
  expect(await calculateDay(day.id, actor)).toMatchObject({ changed: true });
  expect(await calculateDay(day.id, actor)).toMatchObject({ changed: false });
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

it("only queries AMap for station transfers and invalidates the affected endpoint", async () => {
  const { transportInput } = await import("@/domain/transport");
  const plan = transportInput.parse({
    mode: "flight",
    origin: { name: "深圳机场", lat: 22.6, lng: 113.8 },
    destination: { name: "首都机场", lat: 40.0, lng: 116.6 },
  });
  const trip = s.createTrip(actor, { title: "独立交通" });
  const d = s.snapshot(trip.id, actor).days[0];
  s.createItem(d.id, actor, { title: "深圳酒店", lat: 22.3, lng: 114.1 });
  const flight = s.createItem(d.id, actor, {
    title: "待定航班",
    type: "transport",
    transport: plan,
  });
  s.createItem(d.id, actor, { title: "北京酒店", lat: 39.9, lng: 116.4 });
  const spy = vi
    .spyOn(amap, "routes")
    .mockImplementation(async (r) => mockRoutes(r));
  await calculateDay(d.id, actor);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy.mock.calls[0][0]).toMatchObject({
    origin: { lat: 22.3, lng: 114.1 },
    destination: { lat: 22.6, lng: 113.8 },
  });
  expect(spy.mock.calls[1][0]).toMatchObject({
    origin: { lat: 40.0, lng: 116.6 },
    destination: { lat: 39.9, lng: 116.4 },
  });
  const before = s.getDay(d.id),
    outgoing = before.legs.find((l) => l.fromItemId === flight.id)!;
  s.editItem(flight.id, actor, {
    expectedVersion: 1,
    transport: { ...plan, origin: { ...plan.origin, lat: 22.7 } },
  });
  const after = s.getDay(d.id);
  expect(
    after.legs.find((l) => l.toItemId === flight.id)?.alternatives,
  ).toHaveLength(0);
  expect(after.legs.find((l) => l.id === outgoing.id)?.alternatives).toEqual(
    outgoing.alternatives,
  );
  expect(
    after.items.find((i) => i.id === flight.id)?.transport?.destination,
  ).toEqual(plan.destination);
  spy.mockRestore();
});
