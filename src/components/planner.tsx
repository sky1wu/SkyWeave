"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Search,
  Plus,
  GripVertical,
  MoreHorizontal,
  MapPin,
  Clock3,
  AlertTriangle,
  RefreshCw,
  Navigation,
  Map,
  List,
  CalendarDays,
} from "lucide-react";
import { api, ApiFailure } from "@/lib/client";
import type { DayPlan, Item, TripSnapshot } from "@/domain/types";
import type { Place } from "@/amap/requests";
import { typeLabels } from "@/domain/types";
import { calculateTimeline, formatTime } from "@/domain/timeline";
import { ItemEditor, itemPayload, TimeField, readTime } from "./item-editor";
import { TripMap } from "./map";
import { LegCard } from "./leg-card";
import { ErrorText, Modal } from "./ui";
import type { TimelineEntry } from "@/domain/timeline";
export type Mutate = <T = { id: string }>(
  path: string,
  method: string,
  data: unknown,
) => Promise<T>;
function SortableItem({
  item,
  index,
  entry,
  selected,
  editable,
  select,
  edit,
  remove,
  copy,
  move,
  expense,
  comment,
}: {
  item: Item;
  index: number;
  entry: TimelineEntry;
  selected: boolean;
  editable: boolean;
  select: () => void;
  edit: () => void;
  remove: () => void;
  copy: () => void;
  move: (position: "first" | "last" | "up" | "down") => void;
  expense: () => void;
  comment: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !editable });
  const [menu, setMenu] = useState(false);
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={`timeline-item ${selected ? "selected" : ""}`}
      id={`item-${item.id}`}
      data-testid={`item-${item.id}`}
    >
      <div className="item-left">
        <span className="item-number">{index + 1}</span>
        {editable && (
          <button
            className="drag-handle"
            aria-label={`拖动 ${item.title}`}
            title="拖动排序；Alt + 上下方向键快速移动"
            {...attributes}
            {...listeners}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                ["ArrowUp", "ArrowDown"].includes(event.key)
              ) {
                event.preventDefault();
                move(event.key === "ArrowUp" ? "up" : "down");
              } else listeners?.onKeyDown?.(event);
            }}
          >
            <GripVertical size={15} />
          </button>
        )}
      </div>
      <div className="item-body">
        <div className="flex justify-between items-center gap-2">
          <span className="item-time">{formatTime(entry.start)}</span>
          <div className="flex items-center gap-2">
            <span className="pill">{typeLabels[item.type]}</span>
            {editable && (
              <button
                aria-label={`${item.title} 更多操作`}
                onClick={() => setMenu(!menu)}
                className="icon-btn"
              >
                <MoreHorizontal size={18} />
              </button>
            )}
          </div>
        </div>
        <button className="item-title" onClick={select}>
          {item.title}
        </button>
        {item.address && <p className="item-address">{item.address}</p>}
        <div className="item-meta">
          {item.fixedTime && (
            <span>
              <CalendarDays size={12} />
              {item.startMinutes !== null && formatTime(item.startMinutes * 60)}
              {item.endMinutes !== null
                ? ` — ${formatTime(item.endMinutes * 60)}`
                : " 固定活动"}
            </span>
          )}
          <span>
            <Clock3 size={12} />
            停留 {item.stayMinutes} 分钟
          </span>
        </div>
        {item.description && (
          <p className="text-xs muted mt-2">{item.description}</p>
        )}
        {item.notes && <p className="item-notes">{item.notes}</p>}
        {entry.earlyMinutes > 0 && (
          <p className="early-note">提前 {entry.earlyMinutes} 分钟到达</p>
        )}
        {entry.warnings.map((w) => (
          <p className="timeline-warning" key={w}>
            <AlertTriangle size={12} />
            {w}
          </p>
        ))}
        <div className="item-quick-actions">
          {editable && (
            <>
              <button onClick={edit}>编辑</button>
              <button onClick={expense}>＋记一笔</button>
            </>
          )}
          <button onClick={comment}>评论</button>
        </div>
        {menu && (
          <div className="item-menu">
            <button
              onClick={() => {
                copy();
                setMenu(false);
              }}
            >
              复制事项
            </button>
            <button
              onClick={() => {
                move("up");
                setMenu(false);
              }}
            >
              上移
            </button>
            <button
              onClick={() => {
                move("down");
                setMenu(false);
              }}
            >
              下移
            </button>
            <button
              onClick={() => {
                move("first");
                setMenu(false);
              }}
            >
              设为当天起点
            </button>
            <button
              onClick={() => {
                move("last");
                setMenu(false);
              }}
            >
              设为当天终点
            </button>
            <button className="text-red-700" onClick={remove}>
              删除事项
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
export function Planner({
  snapshot,
  mutate,
  refresh,
  addExpense,
  addComment,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
  refresh: () => Promise<void>;
  addExpense: (item: Item) => void;
  addComment: (item: Item) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<Item | "new" | null>(null),
    [point, setPoint] = useState<{ lat: number; lng: number } | undefined>(),
    [picking, setPicking] = useState(false),
    [showMap, setShowMap] = useState(false);
  const [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(""),
    [routing, setRouting] = useState(false),
    [dayEditor, setDayEditor] = useState<DayPlan | "new" | null>(null);
  const day =
    snapshot.days.find((d) => d.id === selectedDay) ?? snapshot.days[0];
  const editable = snapshot.role !== "viewer";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const routeDayId = day?.id,
    routeVersion = day?.version,
    hasRoutes = !!day?.legs.some((l) => l.mode !== "manual");
  const current = useRef({ refresh });
  useEffect(() => {
    current.current = { refresh };
  }, [refresh]);
  useEffect(() => {
    if (!routeDayId || !editable || !hasRoutes) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRouting(true);
      try {
        await api(`/days/${routeDayId}/routes/recalculate`, "POST", {});
        if (!cancelled) await current.current.refresh();
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 409)
          await current.current.refresh();
        else if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setRouting(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [routeDayId, routeVersion, hasRoutes, editable]); // Version changes are the recalculation boundary.
  useEffect(() => {
    if (!query.trim() || !editable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      api<{ places: Place[] }>(
        `/places/autocomplete?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`,
      )
        .then((r) => {
          if (!cancelled) setResults(r.places);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, city, editable]);
  const select = useCallback((item: Item) => {
    setSelected(item.id);
    document
      .getElementById(`item-${item.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reorder(ids: string[]) {
    if (!day) return;
    await mutate(`/days/${day.id}/reorder`, "POST", {
      expectedVersion: day.version,
      itemIds: ids,
    });
  }
  function move(item: Item, position: "first" | "last" | "up" | "down") {
    if (!day) return;
    const ids = day.items.map((i) => i.id),
      index = ids.indexOf(item.id);
    const target =
      position === "first"
        ? 0
        : position === "last"
          ? ids.length - 1
          : position === "up"
            ? Math.max(0, index - 1)
            : Math.min(ids.length - 1, index + 1);
    ids.splice(index, 1);
    ids.splice(target, 0, item.id);
    void act(() => reorder(ids));
  }
  const timeline = day
    ? calculateTimeline(day)
    : { entries: [], departures: {} };
  return (
    <>
      <div className="day-bar">
        <div className="day-tabs">
          {snapshot.days.map((d, i) => (
            <button
              key={d.id}
              className={d.id === day?.id ? "active" : ""}
              onClick={() => {
                setSelectedDay(d.id);
                setSelected(null);
              }}
            >
              <span>DAY {String(i + 1).padStart(2, "0")}</span>
              {d.title}
              <small>{d.date ?? "日期待定"}</small>
            </button>
          ))}
          {editable && (
            <button
              className="add-day"
              aria-label="添加一天"
              onClick={() => setDayEditor("new")}
            >
              <Plus size={19} />
            </button>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {day && editable && (
            <button className="btn" onClick={() => setDayEditor(day)}>
              当天设置
            </button>
          )}
          <div className="mobile-switch">
            <button
              className={!showMap ? "active" : ""}
              onClick={() => setShowMap(false)}
            >
              <List size={16} />
              行程
            </button>
            <button
              className={showMap ? "active" : ""}
              onClick={() => {
                setShowMap(true);
                setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
              }}
            >
              <Map size={16} />
              地图
            </button>
          </div>
        </div>
      </div>
      <div className={`planner-grid ${showMap ? "mobile-show-map" : ""}`}>
        <section className="timeline-pane">
          <div className="timeline-heading">
            <div>
              <span className="eyebrow">A DAY TO REMEMBER</span>
              <h2>{day?.date ? `${day.date} 的安排` : "慢慢计划，好好出发"}</h2>
              <p>
                {day
                  ? `${day.items.length} 个事项 · ${day.legs.length} 段路程`
                  : "添加一天，开始安排行程"}
              </p>
            </div>
            {routing && (
              <span className="text-xs muted flex items-center gap-1">
                <RefreshCw size={12} className="animate-spin" />
                算路中
              </span>
            )}
          </div>
          {editable && day && (
            <div className="place-search">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!query.trim()) return;
                  void act(async () => {
                    setSearching(true);
                    try {
                      const r = await api<{ places: Place[] }>(
                        `/places/search?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`,
                      );
                      setResults(r.places);
                    } finally {
                      setSearching(false);
                    }
                  });
                }}
              >
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="搜索地点"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (!e.target.value) setResults([]);
                    }}
                    placeholder="搜索下一个想去的地方…"
                  />
                  <button aria-label="搜索" type="submit">
                    <ArrowSearch />
                  </button>
                </div>
                <input
                  className="city-input"
                  aria-label="搜索城市"
                  placeholder="城市（可选，如香港）"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </form>
              {query && (
                <div className="search-results">
                  {searching && <p className="text-xs muted p-3">搜索中…</p>}
                  {!searching && results.length === 0 && (
                    <p className="text-xs muted p-3">
                      暂无地点，可按回车进行完整搜索或手动添加。
                    </p>
                  )}
                  {results.map((p) => (
                    <button
                      key={p.amapPoiId}
                      onClick={() =>
                        act(async () => {
                          await mutate(`/days/${day.id}/items`, "POST", {
                            title: p.name,
                            type: "place",
                            address: p.address,
                            amapPoiId: p.amapPoiId,
                            lat: p.lat,
                            lng: p.lng,
                          });
                          setQuery("");
                          setResults([]);
                        })
                      }
                    >
                      <MapPin size={16} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.address}
                          {p.rating ? ` · ★ ${p.rating}` : ""}
                        </small>
                      </span>
                      <Plus size={15} />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => {
                    setPoint(undefined);
                    setEditing("new");
                  }}
                >
                  ＋ 手动添加事项
                </button>
                <button
                  onClick={() => {
                    setPicking(!picking);
                    setShowMap(true);
                  }}
                >
                  ⌖ {picking ? "取消选点" : "地图选点"}
                </button>
              </div>
            </div>
          )}
          <ErrorText error={error} />
          {day && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const ids = day.items.map((i) => i.id),
                  from = ids.indexOf(String(active.id)),
                  to = ids.indexOf(String(over.id));
                ids.splice(from, 1);
                ids.splice(to, 0, String(active.id));
                void act(() => reorder(ids));
              }}
            >
              <SortableContext
                items={day.items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="timeline-list">
                  {day.items.map((item, i) => {
                    const leg = day.legs.find((l) => l.toItemId === item.id);
                    return (
                      <div key={item.id}>
                        {leg && (
                          <LegCard
                            leg={leg}
                            editable={editable}
                            mutate={(data) =>
                              mutate(`/legs/${leg.id}`, "PATCH", data)
                            }
                            recalculate={() =>
                              mutate(`/legs/${leg.id}/route`, "POST", {})
                            }
                          />
                        )}
                        <SortableItem
                          item={item}
                          index={i}
                          entry={timeline.entries[i]}
                          selected={selected === item.id}
                          editable={editable}
                          select={() => select(item)}
                          edit={() => setEditing(item)}
                          remove={() => {
                            if (
                              window.confirm(
                                `删除「${item.title}」？相关费用将保留。`,
                              )
                            )
                              void act(() =>
                                mutate(`/items/${item.id}`, "DELETE", {
                                  expectedVersion: item.version,
                                }),
                              );
                          }}
                          copy={() =>
                            act(() =>
                              mutate(`/days/${day.id}/items`, "POST", {
                                ...itemPayload(item),
                                title: `${item.title}（副本）`,
                              }),
                            )
                          }
                          move={(position) => move(item, position)}
                          expense={() => addExpense(item)}
                          comment={() => addComment(item)}
                        />
                      </div>
                    );
                  })}
                  {day.items.length === 0 && (
                    <div className="empty">
                      <Navigation
                        size={33}
                        className="mx-auto mb-4 opacity-50"
                      />
                      <p>从第一个想去的地方开始。</p>
                      <p className="text-xs mt-3">
                        搜索地点，或添加活动、酒店和手动安排。
                      </p>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          )}
          {day && editable && day.legs.length > 0 && (
            <button
              className="btn w-full mt-5"
              onClick={() =>
                act(() =>
                  mutate(`/days/${day.id}/routes/recalculate`, "POST", {
                    force: true,
                  }),
                )
              }
            >
              <RefreshCw size={14} />
              重新计算当天路线
            </button>
          )}
        </section>
        <section className="map-pane">
          <TripMap
            day={day}
            selected={selected}
            select={select}
            picking={picking}
            pick={(point) => {
              setPoint(point);
              setEditing("new");
              setPicking(false);
            }}
          />
        </section>
      </div>
      {editing && day && (
        <ItemEditor
          item={editing === "new" ? undefined : editing}
          point={editing === "new" ? point : undefined}
          close={() => setEditing(null)}
          save={(data) =>
            mutate(
              editing === "new"
                ? `/days/${day.id}/items`
                : `/items/${editing.id}`,
              editing === "new" ? "POST" : "PATCH",
              data,
            )
          }
        />
      )}{" "}
      {dayEditor && (
        <Modal
          title={dayEditor === "new" ? "添加一天" : "当天设置"}
          close={() => setDayEditor(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                const data = {
                  title: f.get("title"),
                  date: f.get("date") || null,
                  startMinutes: readTime(f, "start") ?? 480,
                  ...(dayEditor === "new"
                    ? {}
                    : { expectedVersion: dayEditor.version }),
                };
                const r = await mutate(
                  dayEditor === "new"
                    ? `/trips/${snapshot.trip.id}/days`
                    : `/days/${dayEditor.id}`,
                  dayEditor === "new" ? "POST" : "PATCH",
                  data,
                );
                setSelectedDay(r.id);
                setDayEditor(null);
              });
            }}
          >
            <ErrorText error={error} />
            <label>
              当天名称
              <input
                name="title"
                required
                defaultValue={
                  dayEditor === "new"
                    ? `第 ${snapshot.days.length + 1} 天`
                    : dayEditor.title
                }
              />
            </label>
            <label>
              日期
              <input
                name="date"
                type="date"
                defaultValue={dayEditor === "new" ? "" : (dayEditor.date ?? "")}
              />
            </label>
            <TimeField
              name="start"
              label="当天开始时间"
              value={dayEditor === "new" ? 480 : dayEditor.startMinutes}
            />
            <div className="actions">
              {dayEditor !== "new" && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm("删除这一天及其事项？费用记录会保留。"))
                      void act(async () => {
                        await mutate(`/days/${dayEditor.id}`, "DELETE", {
                          expectedVersion: dayEditor.version,
                        });
                        setDayEditor(null);
                      });
                  }}
                >
                  删除这一天
                </button>
              )}
              <button className="btn primary">保存</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function ArrowSearch() {
  return <Search size={16} />;
}
