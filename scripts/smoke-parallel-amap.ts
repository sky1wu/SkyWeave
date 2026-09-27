import { config } from "dotenv";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
config({ path: ".env.local", quiet: true });
if (!process.env.AMAP_WEB_SERVICE_KEY)
  throw new Error("真实高德联调需要配置 AMAP_WEB_SERVICE_KEY");
delete process.env.AMAP_TEST_MODE;
const directory = mkdtempSync(`${tmpdir()}/skyweave-live-parallel-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const { amap } = await import("../src/amap/service");
const s = await import("../src/server/service");
const { getDays } = await import("../src/server/service-core");
const { calculateDay } = await import("../src/server/routing");
const { calculateTripTimelines } = await import("../src/domain/timeline");
const { insert, sqlite } = await import("../src/server/db");
const report: {
  checkedAt: string;
  provider: string;
  checks: object[];
  passed: boolean;
} = {
  checkedAt: new Date().toISOString(),
  provider: "live AMap",
  checks: [],
  passed: false,
};
try {
  const queries = ["杭州东站", "杭州萧山国际机场", "杭州西湖湖滨银泰in77"];
  const points: Awaited<ReturnType<typeof amap.search>> = [];
  for (const query of queries) {
    const found = await amap.search(query, "杭州");
    if (!found[0]) throw new Error(`未找到真实地点：${query}`);
    points.push(found[0]);
    report.checks.push({ query, name: found[0].name, found: found.length });
  }
  const actor = {
    id: crypto.randomUUID(),
    name: "真实联调",
    email: "live-parallel@example.test",
  };
  insert("users", { ...actor, createdAt: Date.now(), updatedAt: Date.now() });
  const date = DateTime.now()
    .setZone("Asia/Shanghai")
    .plus({ days: 1 })
    .toISODate()!;
  const trip = s.createTrip(actor, {
    title: "真实高德多人路线联调",
    startDate: date,
    endDate: DateTime.fromISO(date).plus({ days: 1 }).toISODate()!,
  });
  const initial = s.snapshot(trip.id, actor),
    [day, next] = initial.days;
  const participants = [
    initial.participants[0].id,
    s.createParticipant(trip.id, actor, { name: "机场组" }).id,
  ];
  const point = (index: number) => ({
    title: points[index].name,
    lat: points[index].lat,
    lng: points[index].lng,
    amapPoiId: points[index].amapPoiId,
  });
  const join = s.createItem(next.id, actor, {
    ...point(2),
    fixedTime: true,
    startMinutes: 600,
  });
  const branches = participants.map((id, i) => ({
    id: crypto.randomUUID(),
    title: i ? "机场组" : "车站组",
    participantIds: [id],
    startMinutes: 1080,
  }));
  s.createItem(day.id, actor, {
    title: "跨日会合",
    type: "parallel",
    parallelPlan: {
      splitItemId: null,
      joinItemId: join.id,
      joinPolicy: "wait_all",
      branches,
    },
  });
  branches.forEach((branch, i) =>
    s.createItem(day.id, actor, { ...point(i), branchId: branch.id }),
  );
  for (const leg of getDays(trip.id).flatMap((day) => day.legs))
    s.editLeg(leg.id, actor, { expectedVersion: leg.version, mode: "driving" });
  await calculateDay(day.id, actor, true);
  const days = getDays(trip.id),
    legs = days.flatMap((day) => day.legs);
  if (
    legs.length !== 2 ||
    legs.some((leg) => leg.status !== "ready" || !leg.selectedAlternativeId)
  )
    throw new Error("真实高德未能完成两组独立路线");
  for (const leg of legs) {
    const selected = leg.alternatives.find(
      (a) => a.id === leg.selectedAlternativeId,
    )!;
    if (selected.durationSeconds <= 0 || (selected.polyline?.length ?? 0) < 2)
      throw new Error("真实路线缺少有效耗时或道路几何");
    report.checks.push({
      branch: branches.find((b) => b.id === leg.branchId)!.title,
      mode: leg.mode,
      candidates: leg.alternatives.length,
      durationSeconds: selected.durationSeconds,
      distanceMeters: selected.distanceMeters,
      pointCount: selected.polyline!.length,
      arrivalDay: days.find((d) => d.id === leg.dayId)!.date,
    });
  }
  const meeting = calculateTripTimelines(days)
    .get(next.id)!
    .entries.find((entry) => entry.itemId === join.id)!;
  if (
    meeting.rendezvous?.arrivals.length !== 2 ||
    meeting.rendezvous.arrivals.some((a) => a.arrival === null) ||
    meeting.start !== 600 * 60
  )
    throw new Error("真实路线未正确汇总到次日集合时间");
  report.checks.push({
    scenario: "different origins, cross-day rendezvous",
    startMinutes: meeting.start / 60,
    arrivals: meeting.rendezvous.arrivals.map((a) => ({
      group: a.title,
      arrivalMinutes: a.arrival! / 60,
      waitingMinutes: a.waitMinutes,
    })),
  });
  report.passed = true;
  console.log(
    `真实高德多人联调通过：${legs.length} 条独立驾车路线，次日集合时间与等待时间正确。`,
  );
} catch (error) {
  report.checks.push({
    error: error instanceof Error ? error.message : "验证失败",
  });
  console.error(
    error instanceof Error ? error.message : "真实多人路线验证失败",
  );
  process.exitCode = 1;
} finally {
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(
    ".tmp/live-parallel-amap.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  console.log(
    "报告：.tmp/live-parallel-amap.json（不含密钥，测试数据库已清理）",
  );
}
