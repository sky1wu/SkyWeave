"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DayPlan } from "@/domain/types";

function DayTab({
  day,
  selected,
  editable,
  select,
  move,
}: {
  day: DayPlan;
  selected: boolean;
  editable: boolean;
  select: () => void;
  move: (direction: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: day.id, disabled: !editable });
  return (
    <button
      ref={setNodeRef}
      {...(editable ? attributes : {})}
      {...(editable ? listeners : {})}
      className={`day-tab ${selected ? "active" : ""}`}
      data-day-tab-id={day.id}
      aria-current={selected ? "date" : undefined}
      title="点击切换日期；拖动调整顺序；Alt + 左右方向键排序"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      onClick={select}
      onKeyDown={(event) => {
        if (
          editable &&
          event.altKey &&
          ["ArrowLeft", "ArrowRight"].includes(event.key)
        ) {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        } else listeners?.onKeyDown?.(event);
      }}
    >
      {day.title}
      <small>{day.date?.slice(5)}</small>
    </button>
  );
}

export function DayTabs({
  days,
  active,
  editable,
  select,
  reorder,
}: {
  days: DayPlan[];
  active?: string;
  editable: boolean;
  select: (id: string) => void;
  reorder: (ids: string[]) => Promise<unknown>;
}) {
  const [dragging, setDragging] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  async function move(from: number, to: number) {
    if (from === to || to < 0 || to >= days.length) return;
    setBusy(true);
    try {
      await reorder(
        arrayMove(
          days.map((d) => d.id),
          from,
          to,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setDragging(String(event.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event) => {
        setDragging(null);
        if (event.over)
          void move(
            days.findIndex((d) => d.id === event.active.id),
            days.findIndex((d) => d.id === event.over?.id),
          );
      }}
    >
      <div className="day-tabs" aria-label="每日行程" aria-busy={busy}>
        <SortableContext
          items={days.map((d) => d.id)}
          strategy={horizontalListSortingStrategy}
        >
          {days.map((day, i) => (
            <DayTab
              key={day.id}
              day={day}
              selected={day.id === active}
              editable={editable && !busy}
              select={() => select(day.id)}
              move={(direction) => void move(i, i + direction)}
            />
          ))}
        </SortableContext>
      </div>
      {dragging &&
        createPortal(
          <DragOverlay>
            {dragging && (
              <div className="day-drag-preview">
                {days.find((d) => d.id === dragging)?.title}
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
