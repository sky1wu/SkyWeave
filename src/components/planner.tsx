"use client";
import { useConfirmation } from "./confirmation";
import { Button } from "./ui/button";
import { useRef, useState } from "react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
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
  ChevronDown,
  LocateFixed,
  TrainFront,
} from "lucide-react";
import { ApiFailure } from "@/lib/client";
import type { DayPlan, Item, Expense, TripSnapshot } from "@/domain/types";
import { calculateTimeline } from "@/domain/timeline";
import { formatMoney } from "@/domain/money";
import { placeCategories } from "@/domain/planning";
import { ItemEditor, itemPayload, TimeField, readTime } from "./item-editor";
import { TripMap, type MapFocus } from "./map";
import { LegCard } from "./leg-card";
import { TimelineItem } from "./timeline-item";
import { DayTabs } from "./day-tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TransportEditor } from "./transport-editor";
import { PlacePool, PoolPlaceEditor } from "./place-pool";
import { ErrorText, Modal } from "./ui";
import { useDayNavigation } from "./planner/use-day-navigation";
import { useMapFocus } from "./planner/use-map-focus";
import { usePlannerDnD } from "./planner/use-planner-dnd";
import { useRouteRecalculation } from "./planner/use-route-recalculation";
import type { DropTarget, Mutate, PlannerView } from "./planner/types";

export type { Mutate } from "./planner/types";
function DaySection({
  day,
  active,
  children,
  settings,
  addItem,
  addTransport,
  billCount,
  dropTarget,
}: {
  day: DayPlan;
  active: boolean;
  children: React.ReactNode;
  settings: () => void;
  addItem?: () => void;
  addTransport?: () => void;
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
                className="day-transport-action"
                aria-label={`向${day.title}添加交通`}
                title="添加火车、飞机等独立交通"
                onClick={addTransport}
              >
                <TrainFront size={14} />
                交通
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                className="icon-btn"
                aria-label={`向${day.title}添加事项`}
                onClick={addItem}
              >
                <Plus size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                className="icon-btn"
                aria-label={`${day.title}设置`}
                onClick={settings}
              >
                <Settings2 size={15} />
              </Button>
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
  const { confirm, confirmation } = useConfirmation();
  const [selectedDay, setSelectedDay] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [selectedPool, setSelectedPool] = useState<string | null>(null),
    [poolReveal, setPoolReveal] = useState(0),
    [editing, setEditing] = useState<{
      dayId: string;
      item?: Item;
      transport?: boolean;
    } | null>(null),
    [point, setPoint] = useState<{ lat: number; lng: number } | null>(null),
    [picking, setPicking] = useState(false),
    [view, setView] = useState<PlannerView>("timeline"),
    [error, setError] = useState(""),
    [dayEditor, setDayEditor] = useState<DayPlan | null>(null),
    [compactItems, setCompactItems] = useState(false),
    [focus, setFocus] = useState<MapFocus | null>(null);
  const [poolCollapsed, setPoolCollapsed] = useState(false),
    [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const day =
    snapshot.days.find((candidate) => candidate.id === selectedDay) ??
    snapshot.days[0];
  const editable = snapshot.role !== "viewer";
  const categories = [
    ...new Set([
      ...placeCategories,
      ...snapshot.poolPlaces.map((place) => place.placeCategory),
      ...snapshot.days.flatMap((candidate) =>
        candidate.items.map((item) => item.placeCategory),
      ),
    ]),
  ];
  const {
    timelineRef,
    followScroll,
    jumpToDay,
    selectItem,
    lockNavigation,
    markInteraction,
    isLatestInteraction,
    releaseNavigationLock,
  } = useDayNavigation({
    activeDayId: day?.id,
    setSelectedDay,
    setSelected,
    setSelectedPool,
    setFocus,
    setView,
    setTimelineCollapsed,
  });
  const { mapInsets, focusLeg, locate, focusItem, focusDay } = useMapFocus({
    workspaceRef,
    poolCollapsed,
    timelineCollapsed,
    view,
    setFocus,
    setSelected,
    setSelectedDay,
    setSelectedPool,
    setView,
    setError,
    lockNavigation,
    markInteraction,
  });
  const routing = useRouteRecalculation({
    days: snapshot.days,
    editable,
    refresh,
    setError,
  });
  const {
    sensors,
    collision,
    dragTitle,
    dropTarget,
    schedule,
    transfer,
    reorderPool,
    move,
    dragStart,
    dragOver,
    dragCancel,
    dragEnd,
  } = usePlannerDnD({
    snapshot,
    mutate,
    act,
    setSelected,
    setSelectedDay,
    markInteraction,
    isLatestInteraction,
  });
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiFailure && e.status === 409) await refresh();
    }
  }
  return (
    <>
      {error && (
        <div className="planner-error">
          <ErrorText error={error} />
          <button aria-label="关闭提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {confirmation}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={dragStart}
        onDragOver={dragOver}
        onDragCancel={dragCancel}
        onDragEnd={dragEnd}
      >
        <div
          ref={workspaceRef}
          className={`planner-grid pool-layout floating-workspace view-${view}`}
        >
          <div className="map-workspace-controls">
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
                  aria-pressed={view === tab.key}
                  onClick={() => {
                    setView(tab.key);
                    if (tab.key === "pool") {
                      setPoolCollapsed(false);
                      setTimelineCollapsed(false);
                    }
                    if (tab.key === "timeline") setTimelineCollapsed(false);
                  }}
                >
                  <tab.icon size={15} />
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              className="map-overview"
              aria-label="查看当天全图"
              title="查看当天全图"
              onClick={focusDay}
            >
              <LocateFixed size={17} />
            </button>
          </div>
          <section
            className="floating-panel floating-pool"
            data-collapsed={poolCollapsed}
            aria-label="地点池面板"
          >
            <button
              className="floating-panel-heading"
              aria-label={poolCollapsed ? "展开地点池" : "折叠地点池"}
              aria-expanded={!poolCollapsed}
              aria-controls="pool-panel-content"
              onClick={() => setPoolCollapsed(!poolCollapsed)}
            >
              <Library size={17} />
              <strong>地点池</strong>
              <span>{snapshot.poolPlaces.length}</span>
              <ChevronDown
                size={16}
                className={poolCollapsed ? "" : "rotate-180"}
              />
            </button>
            <div
              id="pool-panel-content"
              className="floating-panel-content"
              hidden={poolCollapsed}
            >
              <PlacePool
                snapshot={snapshot}
                selectedId={selectedPool}
                revealRequest={poolReveal}
                heading={false}
                dayId={day?.id}
                mutate={mutate}
                schedule={(place) =>
                  day ? schedule(place, day) : Promise.resolve()
                }
                locate={locate}
                reorder={(place, target) => {
                  void act(() => reorderPool(place, target));
                }}
                pick={() => {
                  setPicking(true);
                  setView("map");
                }}
              />
            </div>
          </section>
          <section
            className="floating-panel floating-timeline"
            data-collapsed={timelineCollapsed}
            aria-label="行程面板"
          >
            <div className="timeline-panel-heading">
              <button
                className="floating-panel-heading"
                aria-label={timelineCollapsed ? "展开行程" : "折叠行程"}
                aria-expanded={!timelineCollapsed}
                aria-controls="timeline-panel-content"
                onClick={() => setTimelineCollapsed(!timelineCollapsed)}
              >
                <List size={18} />
                <strong>行程</strong>
                <span>{snapshot.days.length} 天</span>
                <ChevronDown
                  size={16}
                  className={timelineCollapsed ? "" : "rotate-180"}
                />
              </button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="compact-view-toggle"
                      aria-pressed={compactItems}
                      onClick={() => setCompactItems(!compactItems)}
                    >
                      {compactItems ? "全部展开" : "全部折叠"}
                    </button>
                  }
                />
                <TooltipContent>
                  {compactItems
                    ? "恢复时间、路线和账单详情"
                    : "仅显示名称，便于排序"}
                </TooltipContent>
              </Tooltip>
            </div>
            <div
              id="timeline-panel-content"
              className="floating-panel-content"
              hidden={timelineCollapsed}
            >
              <div className="day-bar planner-toolbar">
                <DayTabs
                  days={snapshot.days}
                  active={day?.id}
                  editable={editable}
                  select={jumpToDay}
                  reorder={(dayIds) =>
                    act(async () => {
                      const interaction = markInteraction();
                      await mutate(
                        `/trips/${snapshot.trip.id}/days/reorder`,
                        "POST",
                        { expectedVersion: snapshot.trip.version, dayIds },
                      );
                      if (day && isLatestInteraction(interaction))
                        jumpToDay(day.id);
                    })
                  }
                />
                <div className="planner-toolbar-actions">
                  {routing && (
                    <span className="routing-state">
                      <RefreshCw size={12} className="animate-spin" />
                      算路中
                    </span>
                  )}
                </div>
              </div>

              <div
                ref={timelineRef}
                className="timeline-pane continuous-timeline"
                data-compact={compactItems}
                onScroll={followScroll}
                onWheel={releaseNavigationLock}
                onTouchStart={releaseNavigationLock}
                onPointerDown={releaseNavigationLock}
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
                      addTransport={
                        editable
                          ? () =>
                              setEditing({
                                dayId: targetDay.id,
                                transport: true,
                              })
                          : undefined
                      }
                      billCount={
                        snapshot.expenses.filter(
                          (e) => e.dayId === targetDay.id,
                        ).length
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
                                <div
                                  className="timeline-leg"
                                  hidden={compactItems}
                                >
                                  <LegCard
                                    leg={leg}
                                    destination={item}
                                    arrival={entry}
                                    editable={editable}
                                    focus={() => focusLeg(targetDay, leg.id)}
                                    mutate={(data) =>
                                      mutate(`/legs/${leg.id}`, "PATCH", data)
                                    }
                                  />
                                </div>
                              )}
                              <TimelineItem
                                compact={compactItems}
                                item={item}
                                index={i}
                                entry={entry}
                                selected={selected === item.id}
                                editable={editable}
                                select={() => {
                                  selectItem(item);
                                  focusItem(item);
                                }}
                                edit={() =>
                                  setEditing({ dayId: targetDay.id, item })
                                }
                                remove={async () => {
                                  if (
                                    await confirm(
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
                                    mutate(
                                      `/days/${targetDay.id}/items`,
                                      "POST",
                                      {
                                        ...itemPayload(item),
                                        title: `${item.title}（副本）`,
                                      },
                                    ),
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
                            <button
                              key={bill.id}
                              onClick={() => editExpense(bill)}
                            >
                              {bill.title}
                              <strong>
                                {formatMoney(bill.amountMinor, bill.currency)}
                              </strong>
                            </button>
                          ))}
                        </div>
                      )}
                    </DaySection>
                  );
                })}
                {!snapshot.days.length && (
                  <div className="empty">在行程设置中选择日期范围。</div>
                )}
              </div>
            </div>
          </section>
          <section className="map-pane">
            <TripMap
              day={day}
              days={snapshot.days}
              pool={snapshot.poolPlaces}
              selectedPool={selectedPool}
              selectPool={(place) => {
                markInteraction();
                setSelected(null);
                setSelectedPool(place.id);
                setPoolReveal((n) => n + 1);
                setPoolCollapsed(false);
                setView("pool");
              }}
              selected={selected}
              focus={focus}
              view={view}
              insets={mapInsets}
              select={selectItem}
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
      {editing &&
        (editing.transport || editing.item?.transport ? (
          <TransportEditor
            item={editing.item}
            places={snapshot.poolPlaces}
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
        ) : (
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
        ))}
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
                  startMinutes: readTime(form, "start") ?? 480,
                });
                setDayEditor(null);
              });
            }}
          >
            <ErrorText error={error} />
            <TimeField
              name="start"
              label="当天开始时间"
              value={dayEditor.startMinutes}
            />
            <div className="actions">
              <Button variant="default" type="submit" className="btn primary">
                保存
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
