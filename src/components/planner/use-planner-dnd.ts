import { useState } from "react";
import {
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { DayPlan, Item, PoolPlace, TripSnapshot } from "@/domain/types";
import type { DropTarget, Mutate, PlannerAction } from "./types";

const collision: CollisionDetection = (args) => {
  const eligible = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) =>
        args.active.data.current?.kind === "pool" ||
        container.data.current?.kind !== "pool",
    ),
  };
  if (!args.pointerCoordinates) return closestCenter(eligible);
  const hits = pointerWithin(eligible).filter(
    (hit) => hit.id !== args.active.id,
  );
  const items = hits.filter((hit) => !String(hit.id).startsWith("day:"));
  return items.length ? items : hits;
};

export function usePlannerDnD({
  snapshot,
  mutate,
  act,
  setSelected,
  setSelectedDay,
  markInteraction,
  isLatestInteraction,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
  act: PlannerAction;
  setSelected: (id: string | null) => void;
  setSelectedDay: (id: string) => void;
  markInteraction: () => number;
  isLatestInteraction: (sequence: number) => boolean;
}) {
  const [dragTitle, setDragTitle] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function schedule(
    place: PoolPlace,
    targetDay: DayPlan,
    beforeItemId: string | null = null,
  ) {
    const interaction = markInteraction();
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
    if (isLatestInteraction(interaction)) setSelected(created.id);
    return created;
  }

  async function transfer(
    item: Item,
    target: DayPlan,
    beforeItemId: string | null,
  ) {
    const source = snapshot.days.find((day) => day.id === item.dayId)!;
    return mutate(`/items/${item.id}/move`, "POST", {
      dayId: target.id,
      beforeItemId,
      expectedVersion: item.version,
      expectedSourceDayVersion: source.version,
      expectedTargetDayVersion: target.version,
    });
  }

  async function reorder(targetDay: DayPlan, itemIds: string[]) {
    await mutate(`/days/${targetDay.id}/reorder`, "POST", {
      expectedVersion: targetDay.version,
      itemIds,
    });
  }

  async function reorderPool(place: PoolPlace, target: PoolPlace) {
    if (place.id === target.id) return;
    const ordered = [...snapshot.poolPlaces];
    const from = ordered.findIndex((candidate) => candidate.id === place.id);
    const to = ordered.findIndex((candidate) => candidate.id === target.id);
    ordered.splice(from, 1);
    ordered.splice(to, 0, place);
    await mutate(`/trips/${snapshot.trip.id}/places/reorder`, "POST", {
      places: ordered.map((candidate) => ({
        id: candidate.id,
        expectedVersion: candidate.version,
      })),
    });
  }

  function move(item: Item, direction: "first" | "last" | "up" | "down") {
    const targetDay = snapshot.days.find((day) => day.id === item.dayId)!;
    const ids = targetDay.items.map((candidate) => candidate.id);
    const from = ids.indexOf(item.id);
    const to =
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
    const targetDay = snapshot.days.find((day) => day.id === dayId);
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
    if (
      event.active.data.current?.kind === "pool" &&
      event.over?.data.current?.kind === "pool"
    ) {
      const place = snapshot.poolPlaces.find(
        (candidate) => candidate.id === event.active.data.current?.placeId,
      );
      const target = snapshot.poolPlaces.find(
        (candidate) => candidate.id === event.over?.data.current?.placeId,
      );
      if (place && target) void act(() => reorderPool(place, target));
      return;
    }
    const target = targetFor(event);
    if (!target) return;
    const targetDay = snapshot.days.find((day) => day.id === target.dayId)!;
    if (event.active.data.current?.kind === "pool") {
      const place = snapshot.poolPlaces.find(
        (candidate) => candidate.id === event.active.data.current?.placeId,
      );
      if (place)
        void act(() => schedule(place, targetDay, target.beforeItemId));
      return;
    }
    const item = snapshot.days
      .flatMap((day) => day.items)
      .find((candidate) => candidate.id === event.active.id);
    if (!item) return;
    if (
      item.dayId === target.dayId &&
      event.over?.data.current?.kind === "item"
    ) {
      const ids = targetDay.items.map((candidate) => candidate.id);
      const from = ids.indexOf(item.id);
      const to = ids.indexOf(String(event.over.id));
      if (from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, item.id);
      void act(() => reorder(targetDay, ids));
    } else void act(() => transfer(item, targetDay, target.beforeItemId));
  }

  return {
    sensors,
    collision,
    dragTitle,
    dropTarget,
    schedule,
    transfer,
    reorderPool,
    move,
    dragStart: (event: DragStartEvent) =>
      setDragTitle(String(event.active.data.current?.title ?? "地点")),
    dragOver: (event: DragOverEvent) => setDropTarget(targetFor(event)),
    dragCancel: () => {
      setDragTitle(null);
      setDropTarget(null);
    },
    dragEnd,
  };
}
