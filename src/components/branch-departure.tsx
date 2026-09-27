"use client";
import { useEffect, useRef, useState } from "react";
import type { DayPlan, Item, PoolPlace } from "@/domain/types";
import type { PlanBranch } from "@/domain/parallel";
import type { Place } from "@/amap/requests";
import { api } from "@/lib/client";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Button } from "./ui/button";
import { ErrorText } from "./ui";

export type DepartureDraft = {
  dayId?: string;
  source:
    | { kind: "item"; itemId: string }
    | { kind: "pool"; placeId: string }
    | {
        kind: "place";
        place: {
          title: string;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          amapPoiId?: string | null;
          placeCategory?: string;
        };
      };
};
export function departureDay(
  branch: PlanBranch,
  draft: DepartureDraft | undefined,
  day: DayPlan,
  days: DayPlan[],
) {
  if (draft?.dayId) return days.find((d) => d.id === draft.dayId) ?? day;
  const itemId =
    draft?.source.kind === "item"
      ? draft.source.itemId
      : branch.departureItemId;
  return (
    days.find((d) => d.items.some((i) => i.id === itemId)) ??
    days.find((d) => d.id === draft?.dayId) ??
    day
  );
}
export function BranchDeparture({
  branch,
  day,
  days,
  pool,
  shared,
  draft,
  onChange,
}: {
  branch: PlanBranch;
  day: DayPlan;
  days: DayPlan[];
  pool: PoolPlace[];
  shared: Item | undefined;
  draft: DepartureDraft | undefined;
  onChange: (
    draft: DepartureDraft | undefined,
    itemId: string | null | undefined,
    dayId: string,
  ) => void;
}) {
  const all = days.flatMap((d) => d.items);
  const other = all.filter(
    (item) =>
      item.branchId !== branch.id &&
      item.type !== "parallel" &&
      item.type !== "note",
  );
  const own = days
    .flatMap((d) => d.items)
    .filter(
      (i) =>
        i.branchId === branch.id && i.type !== "parallel" && i.type !== "note",
    );
  const [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected =
    draft?.source.kind === "pool"
      ? `pool:${draft.source.placeId}`
      : draft?.source.kind === "place"
        ? "new"
        : draft?.source.kind === "item"
          ? `item:${draft.source.itemId}`
          : branch.departureItemId === undefined
            ? "inherit"
            : branch.departureItemId === null
              ? "independent"
              : `item:${branch.departureItemId}`;
  const target = departureDay(branch, draft, day, days);
  const baseDay = own[0] ? days.find((d) => d.id === own[0].dayId)! : day;
  const point = draft?.source.kind === "place" ? draft.source.place : null;
  const first = own[0];
  function choose(value: string) {
    controller.current?.abort();
    setBusy(false);
    setError("");
    setResults([]);
    if (value === "inherit") onChange(undefined, undefined, day.id);
    else if (value === "independent") onChange(undefined, null, day.id);
    else if (value.startsWith("item:")) {
      const item = all.find((i) => i.id === value.slice(5))!;
      if (item.branchId === branch.id)
        onChange(
          { source: { kind: "item", itemId: item.id } },
          item.id,
          item.dayId,
        );
      else
        onChange(
          { dayId: baseDay.id, source: { kind: "item", itemId: item.id } },
          null,
          baseDay.id,
        );
    } else if (value.startsWith("pool:"))
      onChange(
        {
          dayId: baseDay.id,
          source: { kind: "pool", placeId: value.slice(5) },
        },
        null,
        baseDay.id,
      );
    else
      onChange(
        {
          dayId: baseDay.id,
          source: { kind: "place", place: { title: "", lat: null, lng: null } },
        },
        null,
        baseDay.id,
      );
  }
  function changePoint(data: Partial<NonNullable<typeof point>>) {
    onChange(
      {
        dayId: target.id,
        source: { kind: "place", place: { title: "", ...point, ...data } },
      },
      null,
      target.id,
    );
  }
  async function search() {
    if (!query.trim()) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ places: Place[] }>(
        `/places/search?q=${encodeURIComponent(query.trim())}&city=${encodeURIComponent(city.trim())}`,
        "GET",
        undefined,
        { signal: request.signal },
      );
      if (!request.signal.aborted) setResults(data.places);
    } catch (e) {
      if (!request.signal.aborted) setError((e as Error).message);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="branch-departure">
      <Label>
        本组出发地点
        <NativeSelect
          aria-label={`${branch.title}出发地点`}
          value={selected}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="inherit">
            {shared
              ? `使用共同出发点：${shared.title}`
              : first
                ? `使用本组首个地点：${first.title}`
                : "各自出发，稍后补充起点"}
          </option>
          {shared && (
            <option value="independent">独立出发，使用本组首个地点</option>
          )}
          {!shared && branch.departureItemId === null && (
            <option value="independent">各自出发，使用本组首个地点</option>
          )}
          {own.length > 0 && (
            <optgroup label="本组已有安排">
              {own.map((item) => (
                <option key={item.id} value={`item:${item.id}`}>
                  {days.find((d) => d.id === item.dayId)?.title} · {item.title}
                </option>
              ))}
            </optgroup>
          )}
          {other.length > 0 && (
            <optgroup label="行程中的其他地点（复制地点）">
              {other.map((item) => (
                <option key={item.id} value={`item:${item.id}`}>
                  {days.find((d) => d.id === item.dayId)?.title} ·{" "}
                  {item.transport?.origin.name ?? item.title}
                </option>
              ))}
            </optgroup>
          )}
          {pool.some((place) => place.type !== "note") && (
            <optgroup label="地点池">
              {pool
                .filter((place) => place.type !== "note")
                .map((place) => (
                  <option key={place.id} value={`pool:${place.id}`}>
                    {place.title}
                  </option>
                ))}
            </optgroup>
          )}
          <option value="new">搜索或手动新增地点…</option>
        </NativeSelect>
      </Label>
      {draft && (draft.source.kind !== "item" || draft.dayId) && (
        <Label>
          出发日期
          <NativeSelect
            aria-label={`${branch.title}出发日期`}
            value={target.id}
            onChange={(e) =>
              onChange(
                { ...draft, dayId: e.target.value },
                null,
                e.target.value,
              )
            }
          >
            {days
              .filter((d) => d.position >= day.position)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} · {d.date}
                </option>
              ))}
          </NativeSelect>
        </Label>
      )}
      {selected.startsWith("item:") && (
        <p className="text-xs muted">
          起点日期：{target.title} · {target.date}
        </p>
      )}
      {point && (
        <div className="branch-departure-search">
          <div className="field-grid">
            <Label>
              搜索地点
              <Input
                aria-label={`${branch.title}搜索出发地点`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
                placeholder="车站、机场、酒店或地址"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search();
                  }
                }}
              />
            </Label>
            <Label>
              城市（可选）
              <Input
                aria-label={`${branch.title}出发城市`}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={100}
              />
            </Label>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy || !query.trim()}
            onClick={() => void search()}
          >
            {busy ? "搜索中…" : "搜索出发地点"}
          </Button>
          <ErrorText error={error} />
          {results.length > 0 && (
            <ul className="branch-departure-results">
              {results.map((place) => (
                <li key={place.amapPoiId}>
                  <button
                    type="button"
                    onClick={() => {
                      changePoint({
                        title: place.name,
                        address: place.address,
                        lat: place.lat,
                        lng: place.lng,
                        amapPoiId: place.amapPoiId,
                      });
                      setResults([]);
                    }}
                  >
                    <strong>{place.name}</strong>
                    <span>{place.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Label>
            出发地点名称
            <Input
              aria-label={`${branch.title}出发地点名称`}
              required
              maxLength={200}
              value={point.title}
              onChange={(e) => changePoint({ title: e.target.value })}
            />
          </Label>
          <Label>
            地址
            <Input
              aria-label={`${branch.title}出发地址`}
              value={point.address ?? ""}
              maxLength={4000}
              onChange={(e) => changePoint({ address: e.target.value })}
            />
          </Label>
          <details>
            <summary>查看或补充坐标</summary>
            <div className="field-grid">
              <Label>
                纬度
                <Input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  aria-label={`${branch.title}出发纬度`}
                  value={point.lat ?? ""}
                  onChange={(e) =>
                    changePoint({
                      lat:
                        e.target.value === "" ? null : Number(e.target.value),
                      amapPoiId: null,
                    })
                  }
                />
              </Label>
              <Label>
                经度
                <Input
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  aria-label={`${branch.title}出发经度`}
                  value={point.lng ?? ""}
                  onChange={(e) =>
                    changePoint({
                      lng:
                        e.target.value === "" ? null : Number(e.target.value),
                      amapPoiId: null,
                    })
                  }
                />
              </Label>
            </div>
          </details>
          {point.lat == null && (
            <p className="text-xs muted">
              未定位的地点也能先保存，接驳路线稍后补充。
            </p>
          )}
        </div>
      )}
      {(draft || branch.departureItemId) && (
        <p className="text-xs muted">
          此地点作为本组首项；引用其他安排时只复制地点，原安排保留。其他组可选择不同起点。
        </p>
      )}
    </div>
  );
}
