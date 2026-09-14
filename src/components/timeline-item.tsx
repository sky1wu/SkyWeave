"use client";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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
import { transportLabels } from "@/domain/transport";
function formatStayDuration(minutes: number) {
  if (minutes <= 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} 小时${remainder ? ` ${remainder} 分钟` : ""}`;
}
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
  compact = false,
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
  compact?: boolean;
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
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={`timeline-item place-card ${compact ? "compact" : ""} ${editable ? "draggable-card" : ""} ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      id={`item-${item.id}`}
      data-testid={`item-${item.id}`}
      {...cardDragListeners(listeners)}
    >
      {editable && (
        <button
          ref={setActivatorNodeRef}
          data-drag-handle
          className="drag-handle"
          aria-label={`拖动 ${item.title}`}
          title="拖动卡片排序；手机长按；Alt + 上下方向键移动"
          {...attributes}
          onKeyDown={(event) => {
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              move(event.key === "ArrowUp" ? "up" : "down");
            } else listeners?.onKeyDown?.(event);
          }}
        >
          <GripVertical size={15} />
        </button>
      )}
      <div className="item-left">
        <span
          className="item-time"
          aria-label={entry.start === null ? "时间待定" : undefined}
        >
          {entry.start === null ? "待定" : formatTime(entry.start)}
        </span>
        <span className="item-number">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="item-body">
        <div className="item-heading flex justify-between items-center gap-2">
          <button
            className="item-title"
            title={item.title}
            data-card-drag
            onClick={select}
          >
            {item.title}
          </button>
          <div className={compact ? "hidden" : "flex items-center gap-2"}>
            {editable && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="icon-btn"
                    />
                  }
                  aria-label={`${item.title} 更多操作`}
                >
                  <MoreHorizontal size={17} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  data-no-drag
                  align="end"
                  className="sw-item-menu w-44"
                  aria-label={`${item.title}操作`}
                >
                  <DropdownMenuItem onClick={copy}>复制事项</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => move("up")}>
                    上移
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move("down")}>
                    下移
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move("first")}>
                    设为当天起点
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move("last")}>
                    设为当天终点
                  </DropdownMenuItem>
                  {hasPrevious && (
                    <DropdownMenuItem onClick={() => moveDay(-1)}>
                      移至前一天
                    </DropdownMenuItem>
                  )}
                  {hasNext && (
                    <DropdownMenuItem onClick={() => moveDay(1)}>
                      移至后一天
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={remove}>
                    删除事项
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {item.transport ? (
          <div className="transport-card-endpoints">
            <div>
              <strong>{item.transport.origin.name}</strong>
              <small>
                {formatTime(
                  item.startMinutes !== null
                    ? item.startMinutes * 60
                    : entry.start,
                )}
              </small>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <strong>{item.transport.destination.name}</strong>
              <small>
                {formatTime(
                  item.endMinutes !== null
                    ? item.endMinutes * 60
                    : entry.departure,
                )}
              </small>
            </div>
          </div>
        ) : (
          item.address && <p className="item-address">{item.address}</p>
        )}
        <div className="item-meta">
          <PlaceCategory
            name={
              item.transport
                ? transportLabels[item.transport.mode]
                : item.placeCategory !== "未分类"
                  ? item.placeCategory
                  : typeLabels[item.type]
            }
          />
          {item.transport && (
            <>
              <span className={`transport-status ${item.transport.status}`}>
                {item.transport.status === "tentative" ? "暂定" : "已确认"}
              </span>
              {item.transport.serviceNumber && (
                <span>{item.transport.serviceNumber}</span>
              )}
            </>
          )}
          {item.fixedTime && !item.transport && (
            <span>
              <CalendarDays size={12} />
              {item.startMinutes !== null && formatTime(item.startMinutes * 60)}
              {item.endMinutes !== null
                ? ` — ${formatTime(item.endMinutes * 60)}`
                : " 固定活动"}
            </span>
          )}
          {!item.transport && item.stayMinutes > 0 && (
            <span>
              <Clock3 size={12} />
              停留 {formatStayDuration(item.stayMinutes)}
            </span>
          )}
        </div>
        {item.description && (
          <p className="text-xs muted mt-2">{item.description}</p>
        )}
        {item.notes && <p className="item-notes">{item.notes}</p>}
        {item.transport &&
          (item.transport.origin.lat === null ||
            item.transport.destination.lat === null) && (
            <p className="transport-location-state">
              {[
                item.transport.origin.lat === null ? "出发地" : "",
                item.transport.destination.lat === null ? "到达地" : "",
              ]
                .filter(Boolean)
                .join("、")}
              待定位
            </p>
          )}
        <FixedArrival item={item} entry={entry} />
        {entry.warnings
          .filter((w) => !w.startsWith("预计迟到"))
          .filter(
            (w) =>
              !item.transport ||
              ![
                "出发地点待定位",
                "到达地点待定位",
                "交通到达时间待定",
                ...(item.transport.origin.lat === null
                  ? ["相邻地点路线不可用"]
                  : []),
              ].includes(w),
          )
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
      </div>
    </article>
  );
}
