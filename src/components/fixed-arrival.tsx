import type { Item } from "@/domain/types";
import type { TimelineEntry } from "@/domain/timeline";
import { formatTime } from "@/domain/timeline";
export function FixedArrival({
  item,
  entry,
}: {
  item: Item;
  entry: TimelineEntry;
}) {
  if (!item.fixedTime || item.startMinutes === null) return null;
  if (entry.arrival === null)
    return (
      <p className="fixed-arrival unknown">到达时间待定，无法判断是否准时</p>
    );
  const delta = item.startMinutes * 60 - entry.arrival;
  const action = item.transport
    ? item.transport.mode === "flight"
      ? "起飞"
      : "出发"
    : "开始";
  return (
    <p className={`fixed-arrival ${delta < 0 ? "late" : "early"}`}>
      预计 {formatTime(entry.arrival)} 到达 ·{" "}
      {delta < 0
        ? `预计迟到 ${Math.ceil(-delta / 60)} 分钟`
        : delta === 0
          ? "准时到达"
          : delta < 60
            ? `距${action}不足 1 分钟`
            : `距${action}还剩 ${Math.floor(delta / 60)} 分钟`}
    </p>
  );
}
