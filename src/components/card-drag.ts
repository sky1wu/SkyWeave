import type { MouseEvent, TouchEvent } from "react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";

// Keep controls clickable and Alt + mouse available for selecting card text.
function canDrag(target: EventTarget) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-drag-handle], [data-card-drag]")) return true;
  return !target.closest(
    "button, a, input, select, textarea, summary, [contenteditable], [data-no-drag]",
  );
}

export function cardDragListeners(listeners: DraggableSyntheticListeners) {
  return {
    onMouseDown(event: MouseEvent<HTMLElement>) {
      if (!event.altKey && canDrag(event.target))
        listeners?.onMouseDown?.(event);
    },
    onTouchStart(event: TouchEvent<HTMLElement>) {
      if (canDrag(event.target)) listeners?.onTouchStart?.(event);
    },
  };
}
