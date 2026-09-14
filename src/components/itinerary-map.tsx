"use client";

import { ChevronDown, ChevronUp, LocateFixed, MapPinned } from "lucide-react";
import type { DayPlan, Item, PoolPlace } from "@/domain/types";
import type { ItineraryDay } from "@/domain/itinerary";
import { mapLocations } from "@/domain/map-locations";
import { TripMap, type MapFocus, type MapInsets } from "./map";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";

const insets: MapInsets = [12, 50, 12, 12];
const emptyPool: PoolPlace[] = [];
const emptyDays: DayPlan[] = [];
const ignore = () => {};

export function ItineraryMap({
  day,
  days,
  focus,
  selected,
  visible,
  onToggle,
  onDayChange,
  onSelect,
}: {
  day: DayPlan;
  days: ItineraryDay[];
  focus: MapFocus | null;
  selected: string | null;
  visible: boolean;
  onToggle: () => void;
  onDayChange: (dayId: string) => void;
  onSelect: (item: Item) => void;
}) {
  const locations = mapLocations(day, [], []);
  const locatedItems = new Set(locations.map((point) => point.itemId));
  const missing = day.items.filter(
    (item) => item.type !== "note" && !locatedItems.has(item.id),
  ).length;
  return (
    <>
      <header className="itinerary-map-heading">
        <h3 id="itinerary-map-heading">
          <MapPinned size={18} />
          地图参考
        </h3>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={visible}
          aria-controls="itinerary-map-content"
          onClick={onToggle}
        >
          {visible ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {visible ? "收起地图" : "展开地图"}
        </Button>
      </header>
      {visible && (
        <div id="itinerary-map-content">
          <div className="itinerary-map-controls">
            <NativeSelect
              aria-label="地图日期"
              value={day.id}
              onChange={(event) => onDayChange(event.target.value)}
            >
              {days.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  第 {entry.number} 天 · {entry.date}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={!locations.length}
              onClick={() => onDayChange(day.id)}
            >
              <LocateFixed size={15} />
              全日地点
            </Button>
          </div>
          <div className="itinerary-map-canvas">
            {locations.length ? (
              <TripMap
                day={day}
                days={emptyDays}
                pool={emptyPool}
                selectedPool={null}
                selectPool={ignore}
                selected={selected}
                select={onSelect}
                pick={ignore}
                picking={false}
                focus={focus}
                view="map"
                insets={insets}
              />
            ) : (
              <div className="itinerary-map-empty" role="status">
                <MapPinned size={32} strokeWidth={1.4} />
                <strong>
                  {day.items.length ? "当天暂无可定位的地点" : "当天暂无安排"}
                </strong>
                <p>
                  {day.items.length
                    ? "地点补充位置后，会显示在这里。"
                    : "可以切换日期，查看其他天的地点与路线。"}
                </p>
              </div>
            )}
          </div>
          <p className="itinerary-map-help">
            序号对应当天安排，点击地图地点可查看行程。
            {missing > 0 && <span>{missing} 项安排暂无坐标。</span>}
            <span>虚线为交通示意，实际出行请以导航为准。</span>
          </p>
        </div>
      )}
    </>
  );
}
