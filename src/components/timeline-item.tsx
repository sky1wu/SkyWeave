"use client";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  MoreHorizontal,
  CalendarDays,
  Clock3,
  AlertTriangle,
  ReceiptText,
} from "lucide-react";
import type { Item, Expense } from "@/domain/types";
import { typeLabels } from "@/domain/types";
import type { TimelineEntry } from "@/domain/timeline";
import { formatTime } from "@/domain/timeline";
import { formatMoney } from "@/domain/money";
import { FixedArrival } from "./fixed-arrival";
import { cardDragListeners } from "./card-drag";
import { PlaceCategory } from "./place-category";
export function TimelineItem({
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
  bills,
  baseCurrency,
  openBill,
  moveDay,
  hasPrevious,
  hasNext,
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
  bills: Expense[];
  baseCurrency: string;
  openBill: (expense: Expense) => void;
  moveDay: (direction: -1 | 1) => void;
  hasPrevious: boolean;
  hasNext: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { kind: "item", dayId: item.dayId, title: item.title },
    disabled: !editable,
  });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !moreRef.current?.contains(event.target as Node)
      )
        setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={`timeline-item place-card ${editable ? "draggable-card" : ""} ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      id={`item-${item.id}`}
      data-testid={`item-${item.id}`}
      {...cardDragListeners(listeners)}
    >
      <div className="item-left">
        <span className="item-time">{formatTime(entry.start)}</span>
        <span className="item-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        {editable && (
          <button
            ref={setActivatorNodeRef}
            data-drag-handle
            className="drag-handle"
            aria-label={`拖动 ${item.title}`}
            title="拖动卡片排序；手机长按；Alt + 上下方向键移动"
            {...attributes}
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
          <button className="item-title" data-card-drag onClick={select}>
            {item.title}
          </button>
          <div className="flex items-center gap-2">
            {editable && (
              <button
                ref={moreRef}
                aria-label={`${item.title} 更多操作`}
                aria-expanded={menu}
                aria-controls={`item-menu-${item.id}`}
                onClick={() => setMenu(!menu)}
                className="icon-btn"
              >
                <MoreHorizontal size={18} />
              </button>
            )}
          </div>
        </div>
        {item.address && <p className="item-address">{item.address}</p>}
        <div className="item-meta">
          <PlaceCategory
            name={
              item.placeCategory !== "未分类"
                ? item.placeCategory
                : typeLabels[item.type]
            }
          />
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
        <FixedArrival item={item} entry={entry} />
        {entry.warnings
          .filter((w) => !w.startsWith("预计迟到"))
          .map((w) => (
            <p className="timeline-warning" key={w}>
              <AlertTriangle size={12} />
              {w}
            </p>
          ))}
        {bills.length > 0 && (
          <div className="item-bills">
            <div className="item-bills-heading">
              <ReceiptText size={12} />
              关联费用
              {bills.length > 1 && (
                <span>
                  {bills.length} 笔 ·{" "}
                  {formatMoney(
                    bills.reduce((sum, bill) => sum + bill.baseAmountMinor, 0),
                    baseCurrency,
                  )}
                </span>
              )}
            </div>
            {bills.map((bill) => (
              <button
                key={bill.id}
                className="item-bill"
                onClick={() => openBill(bill)}
              >
                <span>{bill.title}</span>
                <strong>{formatMoney(bill.amountMinor, bill.currency)}</strong>
              </button>
            ))}
          </div>
        )}
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
          <div
            ref={menuRef}
            id={`item-menu-${item.id}`}
            className="item-menu"
            data-no-drag
          >
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
            {hasPrevious && (
              <button
                onClick={() => {
                  moveDay(-1);
                  setMenu(false);
                }}
              >
                移至前一天
              </button>
            )}
            {hasNext && (
              <button
                onClick={() => {
                  moveDay(1);
                  setMenu(false);
                }}
              >
                移至后一天
              </button>
            )}
            <button className="text-red-700" onClick={remove}>
              删除事项
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
