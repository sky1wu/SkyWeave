"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Plus,
  RefreshCw,
  Map,
  List,
  Library,
  Settings2,
  ReceiptText,
} from "lucide-react";
import { api, ApiFailure } from "@/lib/client";
import type {
  DayPlan,
  Item,
  PoolPlace,
  Expense,
  TripSnapshot,
} from "@/domain/types";
import { calculateTimeline } from "@/domain/timeline";
import { formatMoney } from "@/domain/money";
import { placeCategories } from "@/domain/planning";
import { ItemEditor, itemPayload, TimeField, readTime } from "./item-editor";
import { TripMap, type MapFocus } from "./map";
import { LegCard } from "./leg-card";
import { TimelineItem } from "./timeline-item";
import { PlacePool, PoolPlaceEditor } from "./place-pool";
import { ErrorText, Modal } from "./ui";
export type Mutate = <T = { id: string }>(
  path: string,
  method: string,
  data: unknown,
) => Promise<T>;
interface DropTarget {
  dayId: string;
  beforeItemId: string | null;
}
function DaySection({
  day,
  active,
  children,
  settings,
  addItem,
  billCount,
  dropTarget,
}: {
  day: DayPlan;
  active: boolean;
  children: React.ReactNode;
  settings: () => void;
  addItem?: () => void;
  billCount: number;
  dropTarget: DropTarget | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${day.id}`,
    data: { kind: "day", dayId: day.id },
  });
  return (
    <section
      ref={setNodeRef}
      id={`day-${day.id}`}
      data-day-id={day.id}
      className={`planner-day ${active ? "active" : ""} ${isOver ? "drop-over" : ""}`}
    >
      <header className="planner-day-heading">
        <div>
          <h2>
            {day.title}
            <span>{day.date ?? "日期待定"}</span>
          </h2>
          <p>
            {day.items.length} 个事项 · {day.legs.length} 段路程
            {billCount > 0 && ` · ${billCount} 笔费用`}
          </p>
        </div>
        <div className="day-actions">
          {addItem && (
            <>
              <button
                className="icon-btn"
                aria-label={`向${day.title}添加事项`}
                onClick={addItem}
              >
                <Plus size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`${day.title}设置`}
                onClick={settings}
              >
                <Settings2 size={15} />
              </button>
            </>
          )}
        </div>
      </header>
      <SortableContext
        items={day.items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
      <div
        className={`day-drop-end ${dropTarget?.dayId === day.id && !dropTarget.beforeItemId ? "drop-indicator" : ""}`}
        data-day-end={day.id}
      >
        {!day.items.length ? "从地点池拖入地点，或添加事项" : ""}
      </div>
    </section>
  );
}
const collision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args).filter((hit) => hit.id !== args.active.id);
  const items = hits.filter((hit) => !String(hit.id).startsWith("day:"));
  return items.length ? items : hits;
};
export function Planner({
  snapshot,
  mutate,
  refresh,
  addExpense,
  editExpense,
  addComment,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
  refresh: () => Promise<void>;
  addExpense: (item: Item) => void;
  editExpense: (expense: Expense) => void;
  addComment: (item: Item) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<{ dayId: string; item?: Item } | null>(
      null,
    ),
    [point, setPoint] = useState<{ lat: number; lng: number } | null>(null),
    [picking, setPicking] = useState(false),
    [view, setView] = useState<"pool" | "timeline" | "map">("timeline"),
    [error, setError] = useState(""),
    [routing, setRouting] = useState(false),
    [dayEditor, setDayEditor] = useState<DayPlan | null>(null),
    [addingDay, setAddingDay] = useState(false),
    [focus, setFocus] = useState<MapFocus | null>(null),
    [dragTitle, setDragTitle] = useState<string | null>(null),
    [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null),
    focusSequence = useRef(0),
    interactionSequence = useRef(0),
    navigationLock = useRef(false),
    navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    scrollFrame = useRef<number | null>(null);
  const day =
    snapshot.days.find((d) => d.id === selectedDay) ?? snapshot.days[0];
  const editable = snapshot.role !== "viewer";
  const categories = [
    ...new Set([
      ...placeCategories,
      ...snapshot.poolPlaces.map((p) => p.placeCategory),
      ...snapshot.days.flatMap((d) => d.items.map((i) => i.placeCategory)),
    ]),
  ];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const current = useRef({ refresh });
  useEffect(() => {
    current.current = { refresh };
  }, [refresh]);
  const routeDayId = day?.id,
    routeVersion = day?.version,
    hasRoutes = !!day?.legs.some((l) => l.mode !== "manual");
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
  }, [routeDayId, routeVersion, hasRoutes, editable]);
  useEffect(() => {
    const timer = setTimeout(
      () => window.dispatchEvent(new Event("resize")),
      30,
    );
    return () => clearTimeout(timer);
  }, [view]);
  useEffect(
    () => () => {
      clearTimeout(navigationTimer.current);
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );
  function followScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (navigationLock.current) return;
      const pane = timelineRef.current;
      if (!pane) return;
      const top = pane.getBoundingClientRect().top,
        sections = [...pane.querySelectorAll<HTMLElement>(".planner-day")];
      let current: HTMLElement | undefined = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= top + 75) current = section;
        else break;
      }
      if (
        pane.scrollHeight > pane.clientHeight + 2 &&
        pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
      )
        current = sections.at(-1);
      const id = current?.dataset.dayId;
      if (id && id !== day?.id) {
        setSelectedDay(id);
        setFocus(null);
      }
    });
  }
  function jumpToDay(id: string) {
    interactionSequence.current++;
    navigationLock.current = true;
    clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      navigationLock.current = false;
    }, 1000);
    setSelectedDay(id);
    setFocus(null);
    setView("timeline");
    requestAnimationFrame(() => {
      const pane = timelineRef.current,
        section = document.getElementById(`day-${id}`);
      if (!pane || !section) return;
      const top = Math.max(
        0,
        Math.min(
          pane.scrollHeight - pane.clientHeight,
          pane.scrollTop +
            section.getBoundingClientRect().top -
            pane.getBoundingClientRect().top,
        ),
      );
      if (Math.abs(pane.scrollTop - top) > 1)
        pane.scrollTo({ top, behavior: "smooth" });
    });
  }
  const select = useCallback((item: Item) => {
    interactionSequence.current++;
    setSelected(item.id);
    setSelectedDay(item.dayId);
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
      if (e instanceof ApiFailure && e.status === 409) await refresh();
    }
  }
  async function appendDay() {
    const interaction = ++interactionSequence.current;
    setAddingDay(true);
    try {
      await act(async () => {
        const created = await mutate(
          `/trips/${snapshot.trip.id}/days`,
          "POST",
          {},
        );
        if (interactionSequence.current === interaction) jumpToDay(created.id);
      });
    } finally {
      setAddingDay(false);
    }
  }
  function focusLeg(targetDay: DayPlan, legId: string) {
    interactionSequence.current++;
    setSelectedDay(targetDay.id);
    setFocus({ kind: "leg", id: legId, request: ++focusSequence.current });
  }
  function locate(place: PoolPlace) {
    interactionSequence.current++;
    if (place.lat === null || place.lng === null) {
      setError("该地点没有坐标，可在地点池中编辑补充");
      return;
    }
    setSelected(null);
    setFocus({
      kind: "point",
      title: place.title,
      lat: place.lat,
      lng: place.lng,
      request: ++focusSequence.current,
    });
    setView("map");
  }
  async function schedule(
    place: PoolPlace,
    targetDay: DayPlan,
    beforeItemId: string | null = null,
  ) {
    const interaction = ++interactionSequence.current;
    setSelectedDay(targetDay.id);
    const created = await mutate(
      `/trips/${snapshot.trip.id}/places/${place.id}/schedule`,
      "POST",
      {
        dayId: targetDay.id,
        beforeItemId,
        expectedVersion: place.version,
        expectedDayVersion: targetDay.version,
      },
    );
    if (interactionSequence.current === interaction) setSelected(created.id);
    return created;
  }
  async function transfer(
    item: Item,
    target: DayPlan,
    beforeItemId: string | null,
  ) {
    const source = snapshot.days.find((d) => d.id === item.dayId)!;
    return mutate(`/items/${item.id}/move`, "POST", {
      dayId: target.id,
      beforeItemId,
      expectedVersion: item.version,
      expectedSourceDayVersion: source.version,
      expectedTargetDayVersion: target.version,
    });
  }
  async function reorder(targetDay: DayPlan, ids: string[]) {
    await mutate(`/days/${targetDay.id}/reorder`, "POST", {
      expectedVersion: targetDay.version,
      itemIds: ids,
    });
  }
  function move(item: Item, direction: "first" | "last" | "up" | "down") {
    const targetDay = snapshot.days.find((d) => d.id === item.dayId)!;
    const ids = targetDay.items.map((i) => i.id),
      from = ids.indexOf(item.id),
      to =
        direction === "first"
          ? 0
          : direction === "last"
            ? ids.length - 1
            : direction === "up"
              ? Math.max(0, from - 1)
              : Math.min(ids.length - 1, from + 1);
    ids.splice(from, 1);
    ids.splice(to, 0, item.id);
    void act(() => reorder(targetDay, ids));
  }
  function targetFor(event: DragOverEvent | DragEndEvent): DropTarget | null {
    if (!event.over) return null;
    const dayId = event.over.data.current?.dayId as string | undefined;
    const targetDay = snapshot.days.find((d) => d.id === dayId);
    if (!targetDay) return null;
    if (event.over.data.current?.kind === "item")
      return { dayId: targetDay.id, beforeItemId: String(event.over.id) };
    const activator = event.activatorEvent;
    const y =
      activator instanceof MouseEvent
        ? activator.clientY + event.delta.y
        : event.active.rect.current.translated
          ? event.active.rect.current.translated.top +
            event.active.rect.current.translated.height / 2
          : Infinity;
    const before = targetDay.items.find((item) => {
      if (item.id === event.active.id) return false;
      const node = document.getElementById(`item-${item.id}`);
      return node && node.getBoundingClientRect().bottom > y;
    });
    return { dayId: targetDay.id, beforeItemId: before?.id ?? null };
  }
  function dragEnd(event: DragEndEvent) {
    setDragTitle(null);
    setDropTarget(null);
    const target = targetFor(event);
    if (!target) return;
    const targetDay = snapshot.days.find((d) => d.id === target.dayId)!;
    if (event.active.data.current?.kind === "pool") {
      const place = snapshot.poolPlaces.find(
        (p) => p.id === event.active.data.current?.placeId,
      );
      if (place)
        void act(() => schedule(place, targetDay, target.beforeItemId));
      return;
    }
    const item = snapshot.days
      .flatMap((d) => d.items)
      .find((i) => i.id === event.active.id);
    if (!item) return;
    if (
      item.dayId === target.dayId &&
      event.over?.data.current?.kind === "item"
    ) {
      const ids = targetDay.items.map((i) => i.id),
        from = ids.indexOf(item.id),
        to = ids.indexOf(String(event.over.id));
      if (from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, item.id);
      void act(() => reorder(targetDay, ids));
    } else void act(() => transfer(item, targetDay, target.beforeItemId));
  }
  return (
    <>
      <div className="day-bar planner-toolbar">
        <div className="day-tabs">
          {snapshot.days.map((d) => (
            <button
              key={d.id}
              className={day?.id === d.id ? "active" : ""}
              onClick={() => jumpToDay(d.id)}
            >
              {d.title}
              <small>{d.date?.slice(5) ?? "日期待定"}</small>
            </button>
          ))}
          {editable && (
            <button
              className="add-day"
              disabled={addingDay}
              aria-label="添加一天"
              onClick={appendDay}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        <div className="planner-toolbar-actions">
          {routing && (
            <span className="routing-state">
              <RefreshCw size={12} className="animate-spin" />
              算路中
            </span>
          )}
          {day && editable && (
            <button className="btn" onClick={() => setDayEditor(day)}>
              当天设置
            </button>
          )}
          <div className="mobile-switch">
            {(
              [
                { key: "pool", label: "地点池", icon: Library },
                { key: "timeline", label: "行程", icon: List },
                { key: "map", label: "地图", icon: Map },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                className={view === tab.key ? "active" : ""}
                onClick={() => setView(tab.key)}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <div className="planner-error">
          <ErrorText error={error} />
          <button aria-label="关闭提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={(event) =>
          setDragTitle(String(event.active.data.current?.title ?? "地点"))
        }
        onDragOver={(event) => setDropTarget(targetFor(event))}
        onDragCancel={() => {
          setDragTitle(null);
          setDropTarget(null);
        }}
        onDragEnd={dragEnd}
      >
        <div className={`planner-grid pool-layout view-${view}`}>
          <PlacePool
            snapshot={snapshot}
            dayId={day?.id}
            mutate={mutate}
            schedule={(place) =>
              day ? schedule(place, day) : Promise.resolve()
            }
            locate={locate}
            pick={() => {
              setPicking(true);
              setView("map");
            }}
          />
          <div
            ref={timelineRef}
            className="timeline-pane continuous-timeline"
            onScroll={followScroll}
            onWheel={() => {
              navigationLock.current = false;
            }}
            onTouchStart={() => {
              navigationLock.current = false;
            }}
            onPointerDown={() => {
              navigationLock.current = false;
            }}
            aria-label="连续行程时间线"
          >
            {snapshot.days.map((targetDay, dayIndex) => {
              const timeline = calculateTimeline(targetDay),
                dayBills = snapshot.expenses.filter(
                  (e) => e.dayId === targetDay.id && !e.dayItemId,
                );
              return (
                <DaySection
                  key={targetDay.id}
                  day={targetDay}
                  active={day?.id === targetDay.id}
                  settings={() => setDayEditor(targetDay)}
                  addItem={
                    editable
                      ? () => setEditing({ dayId: targetDay.id })
                      : undefined
                  }
                  billCount={
                    snapshot.expenses.filter((e) => e.dayId === targetDay.id)
                      .length
                  }
                  dropTarget={dropTarget}
                >
                  <div className="timeline-list">
                    {targetDay.items.map((item, i) => {
                      const leg = targetDay.legs.find(
                          (l) => l.toItemId === item.id,
                        ),
                        entry = timeline.entries.find(
                          (e) => e.itemId === item.id,
                        )!;
                      return (
                        <div
                          key={item.id}
                          className={
                            dropTarget?.dayId === targetDay.id &&
                            dropTarget.beforeItemId === item.id
                              ? "drop-before"
                              : ""
                          }
                        >
                          {leg && (
                            <LegCard
                              leg={leg}
                              destination={item}
                              arrival={entry}
                              editable={editable}
                              focus={() => focusLeg(targetDay, leg.id)}
                              mutate={(data) =>
                                mutate(`/legs/${leg.id}`, "PATCH", data)
                              }
                              recalculate={() =>
                                mutate(`/legs/${leg.id}/route`, "POST", {})
                              }
                            />
                          )}
                          <TimelineItem
                            item={item}
                            index={i}
                            entry={entry}
                            selected={selected === item.id}
                            editable={editable}
                            select={() => {
                              select(item);
                              setFocus({
                                kind: "item",
                                id: item.id,
                                request: ++focusSequence.current,
                              });
                            }}
                            edit={() =>
                              setEditing({ dayId: targetDay.id, item })
                            }
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
                                mutate(`/days/${targetDay.id}/items`, "POST", {
                                  ...itemPayload(item),
                                  title: `${item.title}（副本）`,
                                }),
                              )
                            }
                            move={(direction) => move(item, direction)}
                            expense={() => addExpense(item)}
                            comment={() => addComment(item)}
                            bills={snapshot.expenses.filter(
                              (e) => e.dayItemId === item.id,
                            )}
                            baseCurrency={snapshot.trip.baseCurrency}
                            openBill={editExpense}
                            hasPrevious={dayIndex > 0}
                            hasNext={dayIndex < snapshot.days.length - 1}
                            moveDay={(direction) =>
                              act(() =>
                                transfer(
                                  item,
                                  snapshot.days[dayIndex + direction],
                                  null,
                                ),
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                  {dayBills.length > 0 && (
                    <div className="day-bills">
                      <span>
                        <ReceiptText size={13} />
                        当天费用
                      </span>
                      {dayBills.map((bill) => (
                        <button key={bill.id} onClick={() => editExpense(bill)}>
                          {bill.title}
                          <strong>
                            {formatMoney(bill.amountMinor, bill.currency)}
                          </strong>
                        </button>
                      ))}
                    </div>
                  )}
                  {targetDay.legs.length > 0 && editable && (
                    <button
                      className="day-recalculate"
                      onClick={() =>
                        act(() =>
                          mutate(
                            `/days/${targetDay.id}/routes/recalculate`,
                            "POST",
                            { force: true },
                          ),
                        )
                      }
                    >
                      <RefreshCw size={12} />
                      重新计算{targetDay.title}路线
                    </button>
                  )}
                </DaySection>
              );
            })}
            {!snapshot.days.length && (
              <div className="empty">添加一天后开始安排行程。</div>
            )}
          </div>
          <section className="map-pane">
            <TripMap
              day={day}
              selected={selected}
              focus={focus}
              view={view}
              select={select}
              picking={picking}
              pick={(p) => {
                setPoint(p);
                setPicking(false);
              }}
            />
          </section>
        </div>
        <DragOverlay>
          {dragTitle && <div className="planner-drag-preview">{dragTitle}</div>}
        </DragOverlay>
      </DndContext>
      {editing && (
        <ItemEditor
          item={editing.item}
          categories={categories}
          close={() => setEditing(null)}
          save={(data) =>
            mutate(
              editing.item
                ? `/items/${editing.item.id}`
                : `/days/${editing.dayId}/items`,
              editing.item ? "PATCH" : "POST",
              data,
            )
          }
        />
      )}
      {point && (
        <PoolPlaceEditor
          point={point}
          categories={[
            ...new Set([
              ...placeCategories,
              ...snapshot.poolPlaces.map((p) => p.placeCategory),
            ]),
          ]}
          close={() => setPoint(null)}
          save={(data) =>
            mutate(`/trips/${snapshot.trip.id}/places`, "POST", data)
          }
        />
      )}
      {dayEditor && (
        <Modal title="当天设置" close={() => setDayEditor(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(async () => {
                await mutate(`/days/${dayEditor.id}`, "PATCH", {
                  expectedVersion: dayEditor.version,
                  title: form.get("title"),
                  date: form.get("date") || null,
                  startMinutes: readTime(form, "start") ?? 480,
                });
                setDayEditor(null);
              });
            }}
          >
            <ErrorText error={error} />
            <label>
              当天名称
              <input name="title" required defaultValue={dayEditor.title} />
            </label>
            <label>
              日期
              <input
                name="date"
                type="date"
                defaultValue={dayEditor.date ?? ""}
              />
            </label>
            <TimeField
              name="start"
              label="当天开始时间"
              value={dayEditor.startMinutes}
            />
            <div className="actions">
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
              <button className="btn primary">保存</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
