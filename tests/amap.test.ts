import { describe, it, expect, vi, afterEach } from "vitest";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/geo/gcj02";
import { regionalCoordinates } from "./coordinate-fixtures";
import { AmapClient } from "@/amap/client";
import { AmapService } from "@/amap/service";
import { mapPoi, mapRoute } from "@/amap/mapper";
import { TtlCache } from "@/amap/cache";
const config = {
  AMAP_KEY: "test-only-key",
  AMAP_TIMEOUT_MS: 25,
  AMAP_MAX_CONCURRENT: 2,
  AMAP_MAX_RESPONSE_BYTES: 100000,
};
const step = {
  instruction: "沿道路步行",
  distance: "500",
  polyline: "114.170975,22.295262;114.175,22.300",
};
const plan = {
  distance: "5900",
  cost: { duration: "2520" },
  segments: [
    {
      walking: { distance: "500", steps: [step] },
      bus: {
        buslines: [
          {
            name: "东铁线",
            distance: "5400",
            polyline: "114.175,22.300;114.180,22.320",
          },
        ],
      },
    },
    {},
  ],
};
afterEach(() => vi.unstubAllEnvs());
describe("coordinate boundaries", () => {
  it.each(regionalCoordinates)(
    "$name matches fixed numerical vectors",
    ({ wgs84, gcj02 }) => {
      const forward = wgs84ToGcj02(wgs84),
        inverse = gcj02ToWgs84(gcj02);
      expect(forward.latitude).toBeCloseTo(gcj02.latitude, 8);
      expect(forward.longitude).toBeCloseTo(gcj02.longitude, 8);
      expect(inverse.latitude).toBeCloseTo(wgs84.latitude, 8);
      expect(inverse.longitude).toBeCloseTo(wgs84.longitude, 8);
    },
  );
  it.each([
    [139.6917, 35.6895],
    [126.978, 37.5665],
    [2.3522, 48.8566],
  ])("passes overseas coordinates through", (longitude, latitude) => {
    const p = { longitude, latitude };
    expect(wgs84ToGcj02(p)).toEqual(p);
    expect(gcj02ToWgs84(p)).toEqual(p);
  });
  it("maps native POI ids without Google compatibility and converts coordinates", () => {
    const p = mapPoi({
      id: "B001",
      name: "香港地点",
      location: "114.17097492355126,22.295262221040677",
      pname: "香港",
      cityname: "香港",
      address: "九龙",
      business: { rating: "4.8", tel: [] },
    })!;
    expect(p.amapPoiId).toBe("B001");
    expect(p.lng).toBeCloseTo(114.166, 8);
    expect(p.lat).toBeCloseTo(22.298, 8);
    expect(p.address).toBe("香港九龙");
    expect(p.phone).toBeUndefined();
  });
});
describe.each([
  ["search", "/v5/place/text", "region", "city_limit"],
  ["autocomplete", "/v3/assistant/inputtips", "city", "citylimit"],
] as const)(
  "place %s city scope",
  (method, path, cityParameter, limitParameter) => {
    it.each([
      ["香港", "810000"],
      [" 香港特别行政区 ", "810000"],
      ["澳门", "820000"],
      ["澳门特别行政区", "820000"],
      ["台北", "2958"],
      ["台北市", "2958"],
      ["台中", "2945"],
      ["高雄", "2951"],
      ["台南", "2950"],
      ["深圳", "深圳"],
      ["440300", "440300"],
      ["", null],
      ["  ", null],
    ])(
      "restricts results only when a city is selected (%j)",
      async (city, expectedCity) => {
        vi.stubEnv("AMAP_TEST_MODE", "0");
        const fetcher = vi.fn<(url: URL) => Promise<Response>>(async () =>
          Response.json({
            status: "1",
            infocode: "10000",
            pois: [],
            tips: [],
          }),
        );
        const service = new AmapService(new AmapClient(config, fetcher));

        await expect(service[method]("MUJI", city)).resolves.toEqual([]);

        const url = fetcher.mock.calls[0][0];
        expect(url.pathname).toBe(path);
        expect(url.searchParams.get("keywords")).toBe("MUJI");
        expect(url.searchParams.get(cityParameter)).toBe(expectedCity);
        expect(url.searchParams.get(limitParameter)).toBe(
          expectedCity ? "true" : null,
        );
      },
    );
  },
);
describe("place autocomplete", () => {
  it("includes transit stations alongside POIs and skips suggestions without usable locations", async () => {
    vi.stubEnv("AMAP_TEST_MODE", "0");
    const fetcher = vi.fn<(url: URL) => Promise<Response>>(async () =>
      Response.json({
        status: "1",
        infocode: "10000",
        tips: [
          { id: [], name: "九龙塘地铁站", location: [] },
          {
            id: "BV10321739",
            name: "九龙塘(地铁站)",
            district: "香港特别行政区深水埗区",
            address: "东铁线;观塘线",
            location: "114.180820,22.334207",
          },
          {
            id: "BX09908969",
            name: "九龙塘地铁站D出入口",
            location: "114.181448,22.333742",
          },
          {
            id: "B0KRU14BDW",
            name: "Kowloon Tong Station",
            location: "114.183829,22.333201",
          },
          { id: "BV00000000", name: "无坐标站点", location: [] },
        ],
      }),
    );
    const service = new AmapService(new AmapClient(config, fetcher));
    const places = await service.autocomplete("九龙塘(地铁站)", "香港");
    const url = fetcher.mock.calls[0][0];
    expect(url.pathname).toBe("/v3/assistant/inputtips");
    expect(url.searchParams.get("keywords")).toBe("九龙塘(地铁站)");
    expect(url.searchParams.get("city")).toBe("810000");
    expect(url.searchParams.get("datatype")?.split("|")).toEqual([
      "poi",
      "bus",
    ]);
    expect(places.map((p) => p.name)).toEqual([
      "九龙塘(地铁站)",
      "九龙塘地铁站D出入口",
      "Kowloon Tong Station",
    ]);
    const wgs = gcj02ToWgs84({ longitude: 114.18082, latitude: 22.334207 });
    expect(places[0]).toMatchObject({
      amapPoiId: "BV10321739",
      address: "香港特别行政区深水埗区东铁线;观塘线",
      lat: wgs.latitude,
      lng: wgs.longitude,
    });
  });
});
describe("route mapping and upstream behavior", () => {
  it("retries transient QPS errors once but does not retry exhausted daily quota", async () => {
    let count = 0;
    const fetcher = vi.fn(async () =>
      Response.json(
        ++count === 1
          ? { status: "0", infocode: "10021" }
          : { status: "1", infocode: "10000", pois: [] },
      ),
    );
    await new AmapClient(
      { ...config, AMAP_MIN_INTERVAL_MS: 5 },
      fetcher,
    ).search({});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const quota = vi.fn(async () =>
      Response.json({ status: "0", infocode: "10003" }),
    );
    await expect(
      new AmapClient({ ...config, AMAP_MIN_INTERVAL_MS: 5 }, quota).search({}),
    ).rejects.toMatchObject({ code: "AMAP_QUOTA_EXCEEDED" });
    expect(quota).toHaveBeenCalledTimes(1);
  });
  it("keeps complete alternatives, tolerates empty transit segments, and uses lng/lat order", () => {
    const r = mapRoute(plan, true)!;
    expect(r.durationSeconds).toBe(2520);
    expect(r.summary).toBe("东铁线");
    expect(r.walkingDistanceMeters).toBe(500);
    expect(r.polyline[0][0]).toBeCloseTo(114.166, 5);
    expect(r.geometryComplete).toBe(true);
  });
  it("keeps time-only candidates without inventing geometry and discards invalid durations", () => {
    const r = mapRoute(
      {
        ...plan,
        segments: [{ railway: { name: "跨城铁路", distance: "5900" } }],
      },
      true,
    )!;
    expect(r.geometryComplete).toBe(false);
    expect(r.polyline).toEqual([]);
    expect(r.durationSeconds).toBe(2520);
    expect(mapRoute({ distance: -1, duration: 0 }, false)).toBeUndefined();
  });
  it("preserves every valid transit candidate and caches by departure bucket", async () => {
    vi.stubEnv("AMAP_TEST_MODE", "0");
    const urls: URL[] = [];
    const fetcher = vi.fn(async (url: URL) => {
      urls.push(url);
      return Response.json(
        url.pathname.includes("regeo")
          ? {
              status: "1",
              infocode: "10000",
              regeocode: { addressComponent: { citycode: "1852" } },
            }
          : {
              status: "1",
              infocode: "10000",
              route: {
                transits: [
                  plan,
                  { distance: -1 },
                  { ...plan, cost: { duration: "2800" } },
                  { ...plan, cost: { duration: "3000" } },
                ],
              },
            },
      );
    });
    const service = new AmapService(new AmapClient(config, fetcher));
    const request = {
      mode: "transit" as const,
      origin: { lat: 22.298, lng: 114.166, amapPoiId: "B001" },
      destination: { lat: 22.32, lng: 114.18, amapPoiId: "B002" },
      departureTime: "2026-10-02T09:00:00+08:00",
    };
    expect(await service.routes(request)).toHaveLength(3);
    const count = fetcher.mock.calls.length;
    await service.routes({
      ...request,
      departureTime: "2026-10-02T09:04:00+08:00",
    });
    expect(fetcher).toHaveBeenCalledTimes(count);
    await service.routes({
      ...request,
      departureTime: "2026-10-02T09:05:00+08:00",
    });
    expect(fetcher).toHaveBeenCalledTimes(count + 1);
    const query = urls.find((u) =>
      u.pathname.includes("transit"),
    )!.searchParams;
    expect(query.get("originpoi")).toBe("B001");
    expect(query.get("date")).toBe("2026-10-02");
    expect(query.get("time")).toBe("9-00");
    expect(query.get("AlternativeRoute")).toBe("10");
  });
  it.each([
    ["10001", "AMAP_INVALID_KEY"],
    ["10003", "AMAP_QUOTA_EXCEEDED"],
  ])("normalizes upstream code %s", async (code, expected) => {
    const client = new AmapClient(config, async () =>
      Response.json({
        status: "0",
        infocode: code,
        info: "sensitive upstream fragment",
      }),
    );
    await expect(client.search({ keywords: "地点" })).rejects.toMatchObject({
      code: expected,
    });
  });
  it("handles network timeout, malformed responses, and concurrency limits", async () => {
    const client = new AmapClient(
      { ...config, AMAP_MAX_CONCURRENT: 1 },
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("abort")),
            { once: true },
          ),
        ),
    );
    const first = client.search({});
    const timeout = expect(first).rejects.toMatchObject({
      code: "AMAP_TIMEOUT",
    });
    await expect(client.search({})).rejects.toMatchObject({ status: 503 });
    await timeout;
    const invalid = new AmapClient(
      config,
      async () => new Response("not json"),
    );
    await expect(invalid.search({})).rejects.toMatchObject({ status: 502 });
  });
  it("bounds and expires cached entries", () => {
    let now = 0;
    const c = new TtlCache<number>(2, () => now);
    c.set("a", 1, 10);
    c.set("b", 2, 10);
    c.set("c", 3, 10);
    expect(c.get("a")).toBeUndefined();
    now = 11;
    expect(c.get("b")).toBeUndefined();
  });
});
