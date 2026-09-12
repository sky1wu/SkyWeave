"use client";
import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import { api } from "@/lib/client";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/geo/gcj02";
import type { DayPlan, Item } from "@/domain/types";
import { located } from "@/domain/timeline";
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
      request: number;
    };
// AMap setFitView uses top, bottom, left, right (not CSS clockwise order).
export type MapInsets = [number, number, number, number];
export function TripMap({
  day,
  selected,
  select,
  pick,
  picking,
  focus,
  view,
  insets,
}: {
  day: DayPlan | undefined;
  selected: string | null;
  select: (item: Item) => void;
  pick: (point: { lat: number; lng: number }) => void;
  picking: boolean;
  focus: MapFocus | null;
  view: "pool" | "timeline" | "map";
  insets: MapInsets;
}) {
  const container = useRef<HTMLDivElement>(null),
    instance = useRef<MapObject | null>(null),
    overlays = useRef<unknown[]>([]),
    fit = useRef("");
  const callbacks = useRef({ select, pick, picking });
  const [sdk, setSdk] = useState<SDK | null>(null),
    [error, setError] = useState(""),
    [testMode, setTestMode] = useState(false);
  useEffect(() => {
    callbacks.current = { select, pick, picking };
  }, [select, pick, picking]);
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
    const markers: unknown[] = [];
    const markerByItem = new globalThis.Map<string, unknown>();
    const lineByLeg = new globalThis.Map<string, unknown>();
    for (const [i, item] of (day?.items ?? []).entries())
      if (located(item) && item.type !== "note") {
        const node = document.createElement("button");
        node.className = `map-marker ${selected === item.id ? "active" : ""}`;
        node.textContent = String(i + 1);
        node.title = item.title;
        const marker = new sdk.Marker({
          position: mapPoint(item.lng!, item.lat!),
          content: node,
          offset: new sdk.Pixel(-15, -15),
          zIndex: selected === item.id ? 200 : 100,
        });
        marker.on("click", () => callbacks.current.select(item));
        add(marker);
        markers.push(marker);
        markerByItem.set(item.id, marker);
      }
    for (const leg of day?.legs ?? []) {
      const alternative = leg.alternatives.find(
        (a) => a.id === leg.selectedAlternativeId,
      );
      const a = day?.items.find((i) => i.id === leg.fromItemId),
        b = day?.items.find((i) => i.id === leg.toItemId);
      const points =
        leg.mode === "manual" && a && b && located(a) && located(b)
          ? [
              [a.lng!, a.lat!],
              [b.lng!, b.lat!],
            ]
          : (alternative?.polyline ?? []);
      if (points.length >= 2) {
        const line = new sdk.Polyline({
          path: points.map((p) => mapPoint(p[0], p[1])),
          strokeColor: leg.mode === "manual" ? "#ed9045" : "#3264ef",
          strokeWeight: 5,
          strokeOpacity: 0.8,
          strokeStyle: leg.mode === "manual" ? "dashed" : "solid",
          lineJoin: "round",
          zIndex: focus?.kind === "leg" && focus.id === leg.id ? 50 : 30,
        });
        add(line);
        lineByLeg.set(leg.id, line);
      }
    }
    let targets = markers;
    const focusedLeg =
      focus?.kind === "leg"
        ? day?.legs.find((l) => l.id === focus.id)
        : undefined;
    let signature = JSON.stringify([
      day?.id,
      day?.items.map((i) => [i.id, i.lat, i.lng]),
      view,
    ]);
    if (focusedLeg && focus) {
      targets = [
        markerByItem.get(focusedLeg.fromItemId),
        markerByItem.get(focusedLeg.toItemId),
        lineByLeg.get(focusedLeg.id),
      ].filter(Boolean);
      signature = JSON.stringify([
        day?.id,
        focus.request,
        focusedLeg.id,
        focusedLeg.selectedAlternativeId,
        focusedLeg.manualDurationMinutes,
        view,
      ]);
    } else if (focus?.kind === "item" && markerByItem.has(focus.id)) {
      targets = [markerByItem.get(focus.id)];
      signature = JSON.stringify([
        focus,
        day?.items.find((i) => i.id === focus.id)?.lat,
        day?.items.find((i) => i.id === focus.id)?.lng,
        view,
      ]);
    } else if (focus?.kind === "point") {
      const node = document.createElement("span");
      node.className = "map-marker pool-preview-marker";
      node.textContent = "·";
      node.title = focus.title ?? "地点预览";
      const marker = new sdk.Marker({
        position: mapPoint(focus.lng, focus.lat),
        content: node,
        offset: new sdk.Pixel(-15, -15),
        zIndex: 250,
      });
      add(marker);
      targets = [marker];
      signature = JSON.stringify([focus, view]);
    }
    signature = JSON.stringify([
      signature,
      focus?.kind === "day" ? focus.request : null,
      insets,
    ]);
    const timer = setTimeout(() => {
      if (
        signature !== fit.current &&
        targets.length &&
        container.current?.clientWidth &&
        container.current?.clientHeight
      ) {
        map.setFitView(targets, true, insets);
        fit.current = signature;
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [sdk, day, selected, focus, view, insets]);
  const points =
    day?.items.filter((i) => located(i) && i.type !== "note") ?? [];
  const focusedLeg =
    focus?.kind === "leg"
      ? day?.legs.find((l) => l.id === focus.id)
      : undefined;
  const focusIds = focusedLeg
    ? [focusedLeg.fromItemId, focusedLeg.toItemId]
    : focus?.kind === "item"
      ? [focus.id]
      : [];
  const selectedPoints = points.flatMap((item, i) =>
    focusIds.includes(item.id)
      ? [{ x: 130 + (i % 3) * 180, y: 110 + Math.floor(i / 3) * 140 }]
      : [],
  );
  const testViewBox = selectedPoints.length
    ? `${Math.min(...selectedPoints.map((p) => p.x)) - 80} ${Math.min(...selectedPoints.map((p) => p.y)) - 80} ${Math.max(200, Math.max(...selectedPoints.map((p) => p.x)) - Math.min(...selectedPoints.map((p) => p.x)) + 160)} ${Math.max(180, Math.max(...selectedPoints.map((p) => p.y)) - Math.min(...selectedPoints.map((p) => p.y)) + 160)}`
    : "0 0 700 600";
  return (
    <div
      className={`trip-map ${picking ? "picking" : ""}`}
      data-map-day={day?.id}
      data-focused-leg={focusedLeg?.id ?? ""}
      data-map-insets={insets.join(",")}
    >
      <div ref={container} className="map-container" />
      {(error || (!sdk && !testMode)) && (
        <div
          className="map-unavailable"
          style={{
            top: insets[0],
            bottom: insets[1],
            left: insets[2],
            right: insets[3],
          }}
        >
          <MapPinned size={48} strokeWidth={1.2} />
          <h3>{error ? "地图暂不可用" : "地图加载中"}</h3>
          <p>{error || "正在加载地点和路线。"}</p>
        </div>
      )}
      {testMode && (
        <div
          className="test-map"
          data-testid="test-map"
          style={{
            top: insets[0],
            bottom: insets[1],
            left: insets[2],
            right: insets[3],
          }}
        >
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
                  stroke="#e2e8f2"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="700" height="600" fill="#f3f6fc" />
            <rect width="700" height="600" fill="url(#grid)" />
            {day?.legs.map((leg) => {
              const a = points.findIndex((i) => i.id === leg.fromItemId),
                b = points.findIndex((i) => i.id === leg.toItemId);
              const alt = leg.alternatives.find(
                (x) => x.id === leg.selectedAlternativeId,
              );
              return a >= 0 && b >= 0 && (alt || leg.mode === "manual") ? (
                <line
                  key={leg.id}
                  data-testid={`map-leg-${leg.id}`}
                  data-alternative={leg.selectedAlternativeId ?? "manual"}
                  x1={130 + (a % 3) * 180}
                  y1={110 + Math.floor(a / 3) * 140}
                  x2={130 + (b % 3) * 180}
                  y2={110 + Math.floor(b / 3) * 140}
                  stroke="#3264ef"
                  strokeWidth="5"
                  strokeDasharray={leg.mode === "manual" ? "10 8" : undefined}
                />
              ) : null;
            })}
            {points.map((item, i) => (
              <g
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`地图地点 ${item.title}`}
                onClick={() => select(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") select(item);
                }}
              >
                <circle
                  cx={130 + (i % 3) * 180}
                  cy={110 + Math.floor(i / 3) * 140}
                  r={20}
                  fill={selected === item.id ? "#ff754f" : "#3264ef"}
                />
                <text
                  x={130 + (i % 3) * 180}
                  y={116 + Math.floor(i / 3) * 140}
                  textAnchor="middle"
                  fill="white"
                  fontSize="16"
                >
                  {day!.items.indexOf(item) + 1}
                </text>
                <text
                  x={130 + (i % 3) * 180}
                  y={150 + Math.floor(i / 3) * 140}
                  textAnchor="middle"
                  fill="#455570"
                  fontSize="12"
                >
                  {item.title.slice(0, 12)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
      <div className="map-caption">
        <span>
          <i className="real-line" /> 高德路线
        </span>
        <span>
          <i className="manual-line" /> 手动交通
        </span>
        <span>{points.length} 个地点</span>
      </div>
      {picking && (
        <div className="map-pick-hint">点击地图，添加一个自选地点</div>
      )}
    </div>
  );
}
