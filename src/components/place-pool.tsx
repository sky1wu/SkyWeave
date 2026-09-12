"use client";
import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  GripVertical,
  Plus,
  Search,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/client";
import type { PoolPlace, TripSnapshot } from "@/domain/types";
import type { Place } from "@/amap/requests";
import { inferPlaceCategory, placeCategories } from "@/domain/planning";
import { typeLabels } from "@/domain/types";
import { ErrorText, Modal } from "./ui";
import type { Mutate } from "./planner";

function PoolEntry({
  place,
  count,
  editable,
  dayTitle,
  schedule,
  edit,
  remove,
  locate,
}: {
  place: PoolPlace;
  count: number;
  editable: boolean;
  dayTitle?: string;
  schedule: () => void;
  edit: () => void;
  remove: () => void;
  locate: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool:${place.id}`,
    data: { kind: "pool", placeId: place.id, title: place.title },
    disabled: !editable,
  });
  return (
    <article
      ref={setNodeRef}
      className={`pool-entry ${isDragging ? "dragging" : ""}`}
      data-testid={`pool-${place.id}`}
    >
      <div className="pool-entry-heading">
        {editable && (
          <button
            className="pool-drag-handle"
            aria-label={`拖动地点池 ${place.title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={15} />
          </button>
        )}
        <button className="pool-place-title" onClick={locate}>
          {place.title}
        </button>
      </div>
      {place.address && <p className="pool-address">{place.address}</p>}
      <div className="pool-entry-meta">
        <span>{place.placeCategory}</span>
        <span className={count ? "scheduled-count" : "muted"}>
          {count ? `已安排 ${count} 次` : "未安排"}
        </span>
      </div>
      {place.notes && <p className="pool-address">{place.notes}</p>}
      {editable && (
        <div className="pool-entry-actions">
          <button
            disabled={!dayTitle}
            aria-label={`安排 ${place.title} 到${dayTitle ?? "行程"}`}
            onClick={schedule}
          >
            <Plus size={13} />
            {dayTitle ? `加入${dayTitle}` : "先添加日期"}
          </button>
          <button aria-label={`编辑地点池 ${place.title}`} onClick={edit}>
            <Pencil size={13} />
          </button>
          <button aria-label={`删除地点池 ${place.title}`} onClick={remove}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </article>
  );
}
export function PoolPlaceEditor({
  place,
  point,
  categories,
  close,
  save,
}: {
  place?: PoolPlace;
  point?: { lat: number; lng: number };
  categories: string[];
  close: () => void;
  save: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={place ? "编辑地点" : "添加到地点池"} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            const lat = form.get("lat") === "" ? null : Number(form.get("lat")),
              lng = form.get("lng") === "" ? null : Number(form.get("lng"));
            await save({
              title: form.get("title"),
              type: form.get("type"),
              placeCategory: form.get("placeCategory") || "未分类",
              address: form.get("address") || null,
              lat,
              lng,
              notes: form.get("notes") || null,
              amapPoiId:
                lat === place?.lat && lng === place?.lng
                  ? (place?.amapPoiId ?? null)
                  : null,
              ...(place ? { expectedVersion: place.version } : {}),
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorText error={error} />
        <label>
          地点名称
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={place?.title ?? ""}
          />
        </label>
        <div className="field-grid">
          <label>
            地点分类
            <input
              name="placeCategory"
              list="pool-category-options"
              maxLength={40}
              defaultValue={place?.placeCategory ?? "未分类"}
            />
            <datalist id="pool-category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            事项类型
            <select name="type" defaultValue={place?.type ?? "place"}>
              {Object.entries(typeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          地址
          <input name="address" defaultValue={place?.address ?? ""} />
        </label>
        <div className="field-grid">
          <label>
            纬度（WGS-84）
            <input
              name="lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={point?.lat ?? place?.lat ?? ""}
            />
          </label>
          <label>
            经度（WGS-84）
            <input
              name="lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={point?.lng ?? place?.lng ?? ""}
            />
          </label>
        </div>
        <label>
          备注
          <textarea name="notes" rows={2} defaultValue={place?.notes ?? ""} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "保存中…" : "保存地点"}
        </button>
      </form>
    </Modal>
  );
}
export function PlacePool({
  snapshot,
  dayId,
  mutate,
  schedule,
  locate,
  pick,
}: {
  snapshot: TripSnapshot;
  dayId?: string;
  mutate: Mutate;
  schedule: (place: PoolPlace) => Promise<unknown>;
  locate: (place: PoolPlace) => void;
  pick: () => void;
}) {
  const [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [searching, setSearching] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [arranged, setArranged] = useState("all"),
    [editor, setEditor] = useState<PoolPlace | "new" | null>(null);
  const sequence = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editable = snapshot.role !== "viewer";
  const categories = [
    ...new Set([
      ...placeCategories,
      ...snapshot.poolPlaces.map((p) => p.placeCategory),
      ...snapshot.days.flatMap((d) => d.items.map((i) => i.placeCategory)),
    ]),
  ];
  const counts = new Map<string, number>();
  for (const day of snapshot.days)
    for (const item of day.items)
      if (item.sourcePlaceId)
        counts.set(
          item.sourcePlaceId,
          (counts.get(item.sourcePlaceId) ?? 0) + 1,
        );
  const visible = snapshot.poolPlaces.filter(
    (p) =>
      (!category || p.placeCategory === category) &&
      (arranged === "all" ||
        (arranged === "scheduled" ? !!counts.get(p.id) : !counts.get(p.id))),
  );
  useEffect(() => {
    const request = ++sequence.current;
    if (!query.trim() || !editable) return;
    timer.current = setTimeout(() => {
      setSearching(true);
      api<{ places: Place[] }>(
        `/places/autocomplete?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`,
      )
        .then((r) => {
          if (sequence.current === request) setResults(r.places);
        })
        .catch((e) => {
          if (sequence.current === request) setError(e.message);
        })
        .finally(() => {
          if (sequence.current === request) setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer.current);
    };
  }, [query, city, editable]);
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveSearch(p: Place) {
    setSaving(true);
    try {
      let place = p;
      if (!p.types.length) {
        try {
          place = await api<Place>(`/places/${p.amapPoiId}`);
        } catch {
          /* Search data remains usable when enrichment is unavailable. */
        }
      }
      const category = inferPlaceCategory(place.types);
      const result = await mutate<{ id: string; created: boolean }>(
        `/trips/${snapshot.trip.id}/places`,
        "POST",
        {
          title: place.name,
          amapPoiId: place.amapPoiId,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          placeCategory: category,
          type: category === "住宿" ? "hotel" : "place",
        },
      );
      sequence.current++;
      setQuery("");
      setResults([]);
      setCategory("");
      setArranged("all");
      setStatus(result.created ? "已加入地点池" : "地点已在地点池中");
    } finally {
      setSaving(false);
    }
  }
  return (
    <aside className="pool-pane" aria-label="地点池">
      <div className="pool-toolbar">
        <div className="pool-heading">
          <h2>
            地点池 <span>{snapshot.poolPlaces.length}</span>
          </h2>
          <span className="muted">拖入行程安排</span>
        </div>
        {editable && (
          <>
            <form
              className="pool-search"
              onSubmit={(e) => {
                e.preventDefault();
                clearTimeout(timer.current);
                if (!query.trim()) return;
                const request = ++sequence.current;
                setSearching(true);
                void act(async () => {
                  try {
                    const result = await api<{ places: Place[] }>(
                      `/places/search?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`,
                    );
                    if (request === sequence.current) setResults(result.places);
                  } finally {
                    if (request === sequence.current) setSearching(false);
                  }
                });
              }}
            >
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="搜索地点"
                  placeholder="搜索地点"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setStatus("");
                    if (!e.target.value) {
                      sequence.current++;
                      setResults([]);
                      setSearching(false);
                    }
                  }}
                />
                <button type="submit" aria-label="搜索">
                  <Search size={15} />
                </button>
              </div>
              <input
                className="city-input"
                aria-label="搜索城市"
                placeholder="城市（可选）"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </form>
            {query && (
              <div className="search-results pool-search-results">
                {searching && <p className="muted p-3 text-xs">搜索中…</p>}
                {!searching && !results.length && (
                  <p className="muted p-3 text-xs">
                    暂无结果，可按回车完整搜索。
                  </p>
                )}
                {results.map((p) => (
                  <button
                    key={p.amapPoiId}
                    disabled={saving}
                    aria-label={`收藏 ${p.name}`}
                    onClick={() => act(() => saveSearch(p))}
                  >
                    <MapPin size={15} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.address}</small>
                    </span>
                    <Plus size={15} />
                  </button>
                ))}
              </div>
            )}
            <div className="pool-tools">
              <button onClick={() => setEditor("new")}>
                <Plus size={13} />
                手动地点
              </button>
              <button onClick={pick}>
                <MapPin size={13} />
                地图选点
              </button>
            </div>
          </>
        )}
        <div className="pool-filters">
          <select
            aria-label="筛选地点分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="安排状态"
            value={arranged}
            onChange={(e) => setArranged(e.target.value)}
          >
            <option value="all">全部地点</option>
            <option value="pending">未安排</option>
            <option value="scheduled">已安排</option>
          </select>
        </div>
        <ErrorText error={error} />
        {status && (
          <p className="pool-status" role="status">
            {status}
          </p>
        )}
      </div>
      <div className="pool-list">
        {visible.map((place) => (
          <PoolEntry
            key={place.id}
            place={place}
            count={counts.get(place.id) ?? 0}
            editable={editable}
            dayTitle={snapshot.days.find((d) => d.id === dayId)?.title}
            schedule={() => act(() => schedule(place))}
            edit={() => setEditor(place)}
            locate={() => locate(place)}
            remove={() => {
              if (
                window.confirm(
                  `从地点池移除「${place.title}」？已安排的事项会保留。`,
                )
              )
                void act(() =>
                  mutate(
                    `/trips/${snapshot.trip.id}/places/${place.id}`,
                    "DELETE",
                    { expectedVersion: place.version },
                  ),
                );
            }}
          />
        ))}
        {!visible.length && (
          <p className="empty">
            {snapshot.poolPlaces.length
              ? "没有符合筛选条件的地点"
              : "搜索地点后加入地点池"}
          </p>
        )}
      </div>
      {editor && (
        <PoolPlaceEditor
          place={editor === "new" ? undefined : editor}
          categories={categories}
          close={() => setEditor(null)}
          save={(data) =>
            mutate(
              editor === "new"
                ? `/trips/${snapshot.trip.id}/places`
                : `/trips/${snapshot.trip.id}/places/${editor.id}`,
              editor === "new" ? "POST" : "PATCH",
              data,
            )
          }
        />
      )}
    </aside>
  );
}
