"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import { api } from "@/lib/client";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/geo/gcj02";
import type { DayPlan, Item, PoolPlace } from "@/domain/types";
import { located } from "@/domain/timeline";
import { routeEndpoint } from "@/domain/transport";
import { mapLocations, type MapLocation } from "@/domain/map-locations";
import { mapCategory, markerElement, arrangeMapLabels } from "./map-marker";
import { PlaceCategory } from "./place-category";
import { useDayGeometry } from "./trip-data";
interface MapObject {
  destroy(): void;
  add(object: unknown): void;
  remove(object: unknown): void;
  setFitView(
    objects?: unknown[],
    immediately?: boolean,
    padding?: number[],
  ): void;
  setCenter(point: [number, number]): void;
  off(type: string, listener: () => void): void;
  on(
    type: string,
    listener: (event: {
      lnglat: { getLng(): number; getLat(): number };
    }) => void,
  ): void;
}
interface MarkerObject {
  on(type: string, fn: () => void): void;
}
interface SDK {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => MapObject;
  Marker: new (opts: Record<string, unknown>) => MarkerObject;
  Polyline: new (opts: Record<string, unknown>) => object;
  Pixel: new (x: number, y: number) => object;
}
declare global {
  interface Window {
    AMap?: SDK;
    _AMapSecurityConfig?: { serviceHost: string };
    tripMapLoader?: Promise<SDK>;
  }
}
const mapPoint = (lng: number, lat: number): [number, number] => {
  const p = wgs84ToGcj02({ longitude: lng, latitude: lat });
  return [p.longitude, p.latitude];
};
function load(key: string): Promise<SDK> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (window.tripMapLoader) return window.tripMapLoader;
  window._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/_AMapService`,
  };
  window.tripMapLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(
      () => reject(new Error("地图加载超时，请检查网络后刷新")),
      15000,
    );
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("地图加载失败"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("地图加载失败，请检查网络和 JS Key"));
    };
    document.head.appendChild(script);
  });
  return window.tripMapLoader;
}
export type MapFocus =
  | { kind: "day"; request: number }
  | { kind: "leg" | "item"; id: string; request: number }
  | {
      kind: "point";
      lat: number;
      lng: number;
      title?: string;
      poolPlaceId?: string;
      category?: string;
      request: number;
    };
// AMap setFitView uses top, bottom, left, right (not CSS clockwise order).
export type MapInsets = [number, number, number, number];
export function TripMap({
  day: summaryDay,
  days,
  pool,
  selectedPool,
  selectPool,
  selected,
  select,
  pick,
  picking,
  focus,
  view,
  insets,
}: {
  day: DayPlan | undefined;
  days: DayPlan[];
  pool: PoolPlace[];
  selectedPool: string | null;
  selectPool: (place: PoolPlace) => void;
  selected: string | null;
  select: (item: Item) => void;
  pick: (point: { lat: number; lng: number }) => void;
  picking: boolean;
  focus: MapFocus | null;
  view: "pool" | "timeline" | "map";
  insets: MapInsets;
}) {
  const { day, error: geometryError } = useDayGeometry(summaryDay);
  const container = useRef<HTMLDivElement>(null),
    instance = useRef<MapObject | null>(null),
    overlays = useRef<unknown[]>([]),
    fit = useRef("");
  const callbacks = useRef({ select, selectPool, pick, picking });
  const [sdk, setSdk] = useState<SDK | null>(null),
    [mapError, setError] = useState(""),
    [testMode, setTestMode] = useState(false);
  const error = mapError || geometryError;
  const locations = useMemo(
    () => mapLocations(day, pool, days),
    [day, pool, days],
  );
  useEffect(() => {
    callbacks.current = { select, selectPool, pick, picking };
  }, [select, selectPool, pick, picking]);
  useEffect(() => {
    let cancelled = false;
    api<{ amapJsKey: string; mapAvailable: boolean; testMode: boolean }>(
      "/config",
    )
      .then(async (config) => {
        if (cancelled) return;
        if (config.testMode) {
          setTestMode(true);
          return;
        }
        if (!config.mapAvailable) {
          setError("地图服务尚未配置，请联系部署者完成设置。");
          return;
        }
        const sdk = await load(config.amapJsKey);
        if (cancelled || !container.current) return;
        const map = new sdk.Map(container.current, {
          zoom: 11,
          center: [114.17, 22.31],
          mapStyle: "amap://styles/normal",
          resizeEnable: true,
        });
        instance.current = map;
        map.on("click", (e) => {
          if (!callbacks.current.picking) return;
          const wgs = gcj02ToWgs84({
            longitude: e.lnglat.getLng(),
            latitude: e.lnglat.getLat(),
          });
          callbacks.current.pick({ lat: wgs.latitude, lng: wgs.longitude });
        });
        setSdk(sdk);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      instance.current?.destroy();
      instance.current = null;
    };
  }, []);
  useEffect(() => {
    if (!sdk || !instance.current) return;
    const map = instance.current;
    for (const object of overlays.current) map.remove(object);
    overlays.current = [];
    const add = (object: unknown) => {
      map.add(object);
      overlays.current.push(object);
    };
    const markers = new globalThis.Map<string, unknown>(),
      lineByLeg = new globalThis.Map<string, unknown>(),
      lineByItem = new globalThis.Map<string, unknown>();
    const createMarker = (point: MapLocation) => {
      const active =
        !!(point.itemId && point.itemId === selected) ||
        !!(point.poolPlaceId && point.poolPlaceId === selectedPool);
      const node = markerElement(point, active);
      const marker = new sdk.Marker({
        position: mapPoint(point.lng, point.lat),
        content: node,
        offset: new sdk.Pixel(-17, -17),
        zIndex: active ? 300 : point.itemId ? 200 : 100,
      });
      marker.on("click", () => {
        if (callbacks.current.picking) return;
        if (point.poolPlaceId) {
          const place = pool.find((p) => p.id === point.poolPlaceId);
          if (place) callbacks.current.selectPool(place);
        } else {
          const item = day?.items.find((i) => i.id === point.itemId);
          if (item) callbacks.current.select(item);
        }
      });
      add(marker);
      markers.set(point.id, marker);
      return marker;
    };
    for (const point of locations) createMarker(point);
    for (const leg of day?.legs ?? []) {
      const alternative = leg.alternatives.find(
        (a) => a.id === leg.selectedAlternativeId,
      );
      const a = day?.items.find((i) => i.id === leg.fromItemId),
        b = day?.items.find((i) => i.id === leg.toItemId);
      const from = a && routeEndpoint(a, "departure"),
        to = b && routeEndpoint(b, "arrival");
      const points =
        leg.mode === "manual" && from && to && located(from) && located(to)
          ? [
              [from.lng!, from.lat!],
              [to.lng!, to.lat!],
            ]
          : (alternative?.polyline ?? []);
      if (points.length >= 2) {
        const line = new sdk.Polyline({
          path: points.map((p) => mapPoint(p[0], p[1])),
          strokeColor: leg.mode === "manual" ? "#ed9045" : "#0762DF",
          strokeWeight: 4,
          strokeOpacity: 0.85,
          strokeStyle: leg.mode === "manual" ? "dashed" : "solid",
          lineJoin: "round",
          zIndex: focus?.kind === "leg" && focus.id === leg.id ? 50 : 30,
        });
        add(line);
        lineByLeg.set(leg.id, line);
      }
    }
    for (const item of day?.items ?? [])
      if (
        item.transport &&
        located(item.transport.origin) &&
        located(item.transport.destination)
      ) {
        const { origin, destination } = item.transport;
        const line = new sdk.Polyline({
          path: [
            mapPoint(origin.lng!, origin.lat!),
            mapPoint(destination.lng!, destination.lat!),
          ],
          strokeColor: "#8c70ad",
          strokeWeight: 3,
          strokeOpacity: 0.8,
          strokeStyle: "dashed",
          zIndex: 25,
        });
        add(line);
        lineByItem.set(item.id, line);
      }
    let targets = [...markers.values()];
    const leg =
      focus?.kind === "leg"
        ? day?.legs.find((l) => l.id === focus.id)
        : undefined;
    if (leg) {
      const a = day?.items.find((i) => i.id === leg.fromItemId),
        b = day?.items.find((i) => i.id === leg.toItemId);
      targets = [
        markers.get(a?.transport ? `${a.id}:destination` : leg.fromItemId),
        markers.get(b?.transport ? `${b.id}:origin` : leg.toItemId),
        lineByLeg.get(leg.id),
      ].filter(Boolean);
    } else if (focus?.kind === "item") {
      targets = [
        ...locations
          .filter((p) => p.itemId === focus.id)
          .map((p) => markers.get(p.id)),
        lineByItem.get(focus.id),
      ].filter(Boolean);
    } else if (focus?.kind === "point") {
      const existing = focus.poolPlaceId
        ? markers.get(`pool:${focus.poolPlaceId}`)
        : undefined;
      targets = [
        existing ??
          createMarker({
            id: "preview",
            poolPlaceId: focus.poolPlaceId,
            title: focus.title ?? "地点预览",
            category: focus.category ?? "未分类",
            lat: focus.lat,
            lng: focus.lng,
          }),
      ];
    }
    const signature = JSON.stringify([
      day?.id,
      locations.map((p) => [p.id, p.lat, p.lng]),
      focus,
      leg?.selectedAlternativeId,
      // Geometry arrives after the lightweight snapshot. Fit again when the
      // selected polylines become available, without embedding all coordinates.
      day?.legs.map((route) => {
        const selected = route.alternatives.find(
          (a) => a.id === route.selectedAlternativeId,
        );
        return [route.id, selected?.id, selected?.polyline?.length ?? 0];
      }),
      leg?.manualDurationMinutes,
      view,
      insets,
    ]);
    let frame = 0;
    const arrange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!container.current) return;
        const rect = container.current.getBoundingClientRect();
        arrangeMapLabels(container.current, {
          x: rect.x + insets[2],
          y: rect.y + insets[0],
          width: Math.max(0, rect.width - insets[2] - insets[3]),
          height: Math.max(0, rect.height - insets[0] - insets[1]),
        });
      });
    };
    map.on("zoomend", arrange);
    map.on("moveend", arrange);
    map.on("complete", arrange);
    const timer = setTimeout(() => {
      if (
        signature !== fit.current &&
        targets.length &&
        container.current?.clientWidth &&
        container.current?.clientHeight
      ) {
        map.setFitView(targets, true, [
          insets[0] + 16,
          insets[1] + 35,
          insets[2] + 60,
          insets[3] + 60,
        ]);
        fit.current = signature;
      }
      arrange();
    }, 80);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      map.off("zoomend", arrange);
      map.off("moveend", arrange);
      map.off("complete", arrange);
    };
  }, [sdk, day, pool, locations, selected, selectedPool, focus, view, insets]);
  const focusedLeg =
    focus?.kind === "leg"
      ? day?.legs.find((l) => l.id === focus.id)
      : undefined;
  const ids = focusedLeg
    ? [focusedLeg.fromItemId, focusedLeg.toItemId]
    : focus?.kind === "item"
      ? [focus.id]
      : [];
  const selectedPoints = locations.flatMap((point, i) =>
    (point.itemId && ids.includes(point.itemId)) ||
    (focus?.kind === "point" && point.poolPlaceId === focus.poolPlaceId)
      ? [{ x: 130 + (i % 3) * 180, y: 110 + Math.floor(i / 3) * 140 }]
      : [],
  );
  const testViewBox = selectedPoints.length
    ? `${Math.min(...selectedPoints.map((p) => p.x)) - 80} ${Math.min(...selectedPoints.map((p) => p.y)) - 80} ${Math.max(200, Math.max(...selectedPoints.map((p) => p.x)) - Math.min(...selectedPoints.map((p) => p.x)) + 160)} ${Math.max(180, Math.max(...selectedPoints.map((p) => p.y)) - Math.min(...selectedPoints.map((p) => p.y)) + 160)}`
    : `0 0 700 ${Math.max(600, Math.ceil(locations.length / 3) * 140 + 80)}`;
  const offset = {
    top: insets[0],
    bottom: insets[1],
    left: insets[2],
    right: insets[3],
  };
  const unplanned = locations.filter((p) => p.poolPlaceId).length;
  const pointIndex = (id: string, endpoint: "origin" | "destination") =>
    locations.findIndex(
      (p) => p.itemId === id && (!p.endpoint || p.endpoint === endpoint),
    );
  const testLine = (
    a: number,
    b: number,
    id: string,
    alternative: string,
    independent = false,
  ) =>
    a >= 0 && b >= 0 ? (
      <line
        key={id}
        data-testid={independent ? `map-transport-${id}` : `map-leg-${id}`}
        data-alternative={alternative}
        x1={130 + (a % 3) * 180}
        y1={110 + Math.floor(a / 3) * 140}
        x2={130 + (b % 3) * 180}
        y2={110 + Math.floor(b / 3) * 140}
        stroke={independent ? "#8c70ad" : "#0762DF"}
        strokeWidth="4"
        strokeDasharray={
          independent || alternative === "manual" ? "10 8" : undefined
        }
      />
    ) : null;
  return (
    <div
      className={`trip-map ${picking ? "picking" : ""}`}
      data-map-day={day?.id}
      data-focused-leg={focusedLeg?.id ?? ""}
      data-map-insets={insets.join(",")}
    >
      <div ref={container} className="map-container" />
      {(error || (!sdk && !testMode)) && (
        <div className="map-unavailable" style={offset}>
          <MapPinned size={48} strokeWidth={1.2} />
          <h3>{error ? "地图暂不可用" : "地图加载中"}</h3>
          <p>{error || "正在加载地点和路线。"}</p>
        </div>
      )}
      {testMode && (
        <div className="test-map" data-testid="test-map" style={offset}>
          <span className="pill absolute top-5 left-5">
            模拟高德 · 仅测试环境
          </span>
          <svg viewBox={testViewBox} role="img" aria-label="测试地图">
            <defs>
              <pattern
                id="grid"
                width="60"
                height="60"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 60 0 L 0 0 0 60"
                  fill="none"
                  stroke="#DBE5F0"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="700" height="2000" fill="#F0F6FD" />
            <rect width="700" height="2000" fill="url(#grid)" />
            {day?.legs.map(
              (leg) =>
                (leg.selectedAlternativeId || leg.mode === "manual") &&
                testLine(
                  pointIndex(leg.fromItemId, "destination"),
                  pointIndex(leg.toItemId, "origin"),
                  leg.id,
                  leg.selectedAlternativeId ?? "manual",
                ),
            )}
            {day?.items
              .filter((i) => i.transport)
              .map((item) =>
                testLine(
                  pointIndex(item.id, "origin"),
                  pointIndex(item.id, "destination"),
                  item.id,
                  "independent",
                  true,
                ),
              )}
            {locations.map((point, i) => {
              const activate = () => {
                const place = pool.find((p) => p.id === point.poolPlaceId),
                  item = day?.items.find((p) => p.id === point.itemId);
                if (place) selectPool(place);
                else if (item) select(item);
              };
              return (
                <g
                  key={point.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${point.poolPlaceId ? "未安排地点" : "地图地点"} ${point.title}`}
                  data-pool-place-id={point.poolPlaceId}
                  data-item-id={point.itemId}
                  data-icon={mapCategory(point.category).icon}
                  data-category={point.category}
                  onClick={activate}
                  onKeyDown={(e) => {
                    if (["Enter", " "].includes(e.key)) {
                      e.preventDefault();
                      activate();
                    }
                  }}
                >
                  <circle
                    cx={130 + (i % 3) * 180}
                    cy={110 + Math.floor(i / 3) * 140}
                    r={20}
                    fill={
                      point.poolPlaceId
                        ? "white"
                        : mapCategory(point.category).color
                    }
                    stroke={mapCategory(point.category).color}
                    strokeWidth="2"
                  />
                  <foreignObject
                    x={117 + (i % 3) * 180}
                    y={98 + Math.floor(i / 3) * 140}
                    width={26}
                    height={26}
                  >
                    <span
                      className={`test-map-category ${point.poolPlaceId ? "" : "on-color"}`}
                    >
                      <PlaceCategory name={point.category} />
                    </span>
                  </foreignObject>
                  {point.number !== undefined && (
                    <text
                      x={150 + (i % 3) * 180}
                      y={99 + Math.floor(i / 3) * 140}
                      fontSize="13"
                      fill="#18324B"
                    >
                      {point.number}
                    </text>
                  )}
                  <text
                    className="test-map-label"
                    x={130 + (i % 3) * 180}
                    y={150 + Math.floor(i / 3) * 140}
                    textAnchor="middle"
                    fill="#425E78"
                    fontSize="12"
                  >
                    {point.title}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="map-caption">
        <span>
          <i className="real-line" />
          高德路线
        </span>
        <span>
          <i className="manual-line" />
          独立／手动交通
        </span>
        <span>{locations.length - unplanned} 个行程地点</span>
        {unplanned > 0 && (
          <span className="unplanned-legend">{unplanned} 个未安排</span>
        )}
      </div>
      {picking && (
        <div className="map-pick-hint">点击地图，添加一个自选地点</div>
      )}
    </div>
  );
}
