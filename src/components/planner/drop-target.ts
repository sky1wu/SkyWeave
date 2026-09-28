import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragMoveEvent,
  type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { orderedItems } from "@/domain/parallel";
import type { DayPlan } from "@/domain/types";
import type { DropTarget } from "./types";

/** Keep hit testing in viewport coordinates, including during auto-scroll. */
export function plannerCollisionDetection(days: DayPlan[]): CollisionDetection {
  return (args) => {
    const pointer = args.pointerCoordinates;
    const containers = new Map(args.droppableContainers.map((c) => [c.id, c]));
    const viewportRects = new Map<Element, DOMRect>();
    const eligible = {
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => {
        if (
          container.id === args.active.id ||
          (args.active.data.current?.kind !== "pool" &&
            container.data.current?.kind === "pool")
        )
          return false;
        // Cards outside the visible scroll panel must not intercept a drop.
        const viewport = container.node.current?.closest(
          ".continuous-timeline, .pool-list",
        );
        if (!pointer || !viewport) return true;
        let rect = viewportRects.get(viewport);
        if (!rect) {
          rect = viewport.getBoundingClientRect();
          viewportRects.set(viewport, rect);
        }
        return (
          pointer.x >= rect.left &&
          pointer.x <= rect.right &&
          pointer.y >= rect.top &&
          pointer.y <= rect.bottom
        );
      }),
    };
    const hits = pointer ? pointerWithin(eligible) : closestCenter(eligible);
    if (pointer) {
      const priority = (id: string | number) => {
        const kind = containers.get(id)?.data.current?.kind;
        return kind === "day" ? 2 : kind === "branch" ? 1 : 0;
      };
      hits.sort((a, b) => {
        const rank = priority(a.id) - priority(b.id);
        if (rank) return rank;
        // A nested lane wins over its enclosing lane.
        const aRect = args.droppableRects.get(a.id);
        const bRect = args.droppableRects.get(b.id);
        return (
          (aRect ? aRect.width * aRect.height : Infinity) -
          (bRect ? bRect.width * bRect.height : Infinity)
        );
      });
    }
    const hit = hits[0];
    if (!hit) return hits;
    const over = containers.get(hit.id)!;
    const day = days.find((d) => d.id === over.data.current?.dayId);
    if (!day) return hits;
    const hovered = day.items.find((item) => item.id === hit.id);
    const branchId =
      over.data.current?.kind === "branch"
        ? (over.data.current.branchId as string)
        : (hovered?.branchId ?? null);
    const siblings = orderedItems(day.items).filter(
      (item) =>
        (item.branchId ?? null) === branchId && item.id !== args.active.id,
    );
    const source = day.items.find((item) => item.id === args.active.id);
    let beforeItemId: string | null;
    if (hovered && source && (source.branchId ?? null) === branchId) {
      // Match the existing sortable displacement when moving within a lane.
      const index = siblings.findIndex((item) => item.id === hovered.id);
      beforeItemId =
        siblings[index + (source.position < hovered.position ? 1 : 0)]?.id ??
        null;
    } else {
      const y =
        pointer?.y ?? args.collisionRect.top + args.collisionRect.height / 2;
      const before = siblings.find((item) => {
        const container = containers.get(item.id);
        const rect = container
          ? args.droppableRects.get(item.id)
          : item.parallelPlan
            ? document
                .getElementById(`item-${item.id}`)
                ?.getBoundingClientRect()
            : null;
        return rect && rect.height > 0 && y < rect.top + rect.height / 2;
      });
      beforeItemId = before?.id ?? null;
    }
    const dropTarget: DropTarget = { dayId: day.id, branchId, beforeItemId };
    // Both preview and commit read the same collision result. Event deltas
    // include scroll offsets and cannot be used as pointer coordinates.
    return [{ ...hit, data: { ...hit.data, dropTarget } }, ...hits.slice(1)];
  };
}

export function dropTargetFor(event: DragMoveEvent): DropTarget | null {
  return event.collisions?.[0]?.data?.dropTarget ?? null;
}

export const pointerPreview: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  const point = activatorEvent && getEventCoordinates(activatorEvent);
  if (!point || !activeNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + point.x - activeNodeRect.left + 12,
    y: transform.y + point.y - activeNodeRect.top + 12,
  };
};
