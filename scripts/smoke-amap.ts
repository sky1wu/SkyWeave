import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
config({ path: ".env.local", quiet: true });
if (!process.env.AMAP_WEB_SERVICE_KEY)
  throw new Error("请先填写 .env.local 中的 AMAP_WEB_SERVICE_KEY");
delete process.env.AMAP_TEST_MODE;
const { AmapService } = await import("../src/amap/service");
const service = new AmapService();
const queries = [
  ["西安SKP", "西安"],
  ["大唐不夜城", "西安"],
  ["大雁塔", "西安"],
  ["钟楼", "西安"],
  ["电玩鲸电竞民宿", "深圳"],
  ["福田口岸", "深圳"],
  ["落马洲站", "香港"],
  ["INCUBASE Arena", "香港"],
  ["无印良品 旺角", "香港"],
  ["星光大道", "香港"],
  ["中环站", "香港"],
  ["亚洲国际博览馆", "香港"],
  ["皇岗口岸", "深圳"],
  ["澳门塔", "澳门"],
  ["台北101", "台北"],
];
type Place = Awaited<ReturnType<typeof service.details>>;
const found: Record<string, Place> = {};
const report: {
  checkedAt: string;
  provider: string;
  searches: object[];
  routes: object[];
} = {
  checkedAt: new Date().toISOString(),
  provider: "live AMap",
  searches: [],
  routes: [],
};
let failedChecks = 0;
for (const [q, city] of queries) {
  try {
    const places = await service.search(q, city);
    const first = places[0];
    if (first) found[q] = first;
    report.searches.push({
      q,
      city,
      count: places.length,
      first: first ?? null,
    });
    if (!first) failedChecks += 1;
    console.log(
      `${q}: ${places.length ? `找到 ${places.length} 个结果，首个为 ${first.name}` : "未找到"}`,
    );
  } catch (error) {
    failedChecks += 1;
    report.searches.push({ q, error: (error as Error).message });
    console.log(`${q}: ${(error as Error).message}`);
  }
}
for (const [from, to, mode] of [
  ["西安SKP", "大雁塔", "walking"],
  ["西安SKP", "大雁塔", "driving"],
  ["西安SKP", "大雁塔", "cycling"],
  ["西安SKP", "大雁塔", "transit"],
  ["落马洲站", "星光大道", "transit"],
  ["中环站", "亚洲国际博览馆", "transit"],
] as const) {
  if (!found[from] || !found[to]) {
    failedChecks += 1;
    report.routes.push({ from, to, mode, skipped: "未找到端点" });
    continue;
  }
  try {
    const results = await service.routes({
      mode,
      origin: {
        lat: found[from].lat,
        lng: found[from].lng,
        amapPoiId: found[from].amapPoiId,
      },
      destination: {
        lat: found[to].lat,
        lng: found[to].lng,
        amapPoiId: found[to].amapPoiId,
      },
      departureTime: "2026-10-02T09:00:00+08:00",
    });
    report.routes.push({
      from,
      to,
      mode,
      count: results.length,
      alternatives: results.map((r) => ({
        durationSeconds: r.durationSeconds,
        distanceMeters: r.distanceMeters,
        summary: r.summary,
        geometryComplete: r.geometryComplete,
        pointCount: r.polyline.length,
      })),
    });
    if (!results.length) failedChecks += 1;
    console.log(`${from} → ${to} (${mode}): ${results.length} 个候选`);
  } catch (error) {
    failedChecks += 1;
    report.routes.push({ from, to, mode, error: (error as Error).message });
    console.log(`${from} → ${to}: ${(error as Error).message}`);
  }
}
mkdirSync(".tmp", { recursive: true });
writeFileSync(".tmp/live-amap-results.json", JSON.stringify(report, null, 2));
console.log("真实联调报告已保存至 .tmp/live-amap-results.json（不含密钥）。");
if (failedChecks) {
  console.error(`真实高德联调有 ${failedChecks} 项检查失败。`);
  process.exitCode = 1;
}
