import { useMemo, useState } from "react";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { DayPlan, Item, PoolPlace, TripSnapshot } from "@/domain/types";
import type { DropTarget, Mutate, PlannerAction } from "./types";

import { dropTargetFor, plannerCollisionDetection } from "./drop-target";

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
  const [dragFromPool, setDragFromPool] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const collision = useMemo(
    () => plannerCollisionDetection(snapshot.days),
    [snapshot.days],
  );
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
    branchId?: string | null,
  ) {
    const interaction = markInteraction();
    setSelectedDay(targetDay.id);
    const created = await mutate(
      `/trips/${snapshot.trip.id}/places/${place.id}/schedule`,
      "POST",
      {
        dayId: targetDay.id,
        beforeItemId,
        ...(branchId !== undefined ? { branchId } : {}),
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
    branchId?: string | null,
  ) {
    const source = snapshot.days.find((day) => day.id === item.dayId)!;
    return mutate(`/items/${item.id}/move`, "POST", {
      dayId: target.id,
      beforeItemId,
      ...(branchId !== undefined ? { branchId } : {}),
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
    const siblings = targetDay.items.filter(
      (i) => (i.branchId ?? null) === (item.branchId ?? null),
    );
    const ids = siblings.map((candidate) => candidate.id);
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
    const siblingIds = new Set(ids);
    let offset = 0;
    void act(() =>
      reorder(
        targetDay,
        targetDay.items.map((i) =>
          siblingIds.has(i.id) ? ids[offset++] : i.id,
        ),
      ),
    );
  }

  function updateDropTarget(event: DragMoveEvent) {
    const next = dropTargetFor(event);
    setDropTarget((previous) =>
      previous?.dayId === next?.dayId &&
      previous?.branchId === next?.branchId &&
      previous?.beforeItemId === next?.beforeItemId
        ? previous
        : next,
    );
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
    const target = dropTargetFor(event);
    if (!target) return;
    const targetDay = snapshot.days.find((day) => day.id === target.dayId)!;
    if (event.active.data.current?.kind === "pool") {
      const place = snapshot.poolPlaces.find(
        (candidate) => candidate.id === event.active.data.current?.placeId,
      );
      if (place)
        void act(() =>
          schedule(place, targetDay, target.beforeItemId, target.branchId),
        );
      return;
    }
    const item = snapshot.days
      .flatMap((day) => day.items)
      .find((candidate) => candidate.id === event.active.id);
    if (!item) return;
    if (
      item.dayId === target.dayId &&
      (item.branchId ?? null) === (target.branchId ?? null)
    ) {
      const siblings = targetDay.items.filter(
        (candidate) => (candidate.branchId ?? null) === (item.branchId ?? null),
      );
      const reordered = siblings.filter(
        (candidate) => candidate.id !== item.id,
      );
      const index = reordered.findIndex(
        (candidate) => candidate.id === target.beforeItemId,
      );
      reordered.splice(index < 0 ? reordered.length : index, 0, item);
      if (reordered.every((candidate, i) => candidate.id === siblings[i].id))
        return;
      const siblingIds = new Set(siblings.map((candidate) => candidate.id));
      let offset = 0;
      const ids = targetDay.items.map((candidate) =>
        siblingIds.has(candidate.id) ? reordered[offset++].id : candidate.id,
      );
      void act(() => reorder(targetDay, ids));
    } else
      void act(() =>
        transfer(item, targetDay, target.beforeItemId, target.branchId),
      );
  }

  return {
    sensors,
    collision,
    dragTitle,
    dragFromPool,
    dropTarget,
    schedule,
    transfer,
    reorderPool,
    move,
    dragStart: (event: DragStartEvent) => {
      setDragTitle(String(event.active.data.current?.title ?? "地点"));
      setDragFromPool(event.active.data.current?.kind === "pool");
    },
    dragMove: updateDropTarget,
    dragOver: updateDropTarget,
    dragCancel: () => {
      setDragTitle(null);
      setDropTarget(null);
    },
    dragEnd,
  };
}
