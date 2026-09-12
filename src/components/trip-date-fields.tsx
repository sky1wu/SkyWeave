"use client";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useState } from "react";
import { DateTime } from "luxon";
import { addDays, MAX_TRIP_DAYS, tripDayCount } from "@/domain/calendar";

export function TripDateFields({
  startDate,
  endDate,
}: {
  startDate?: string | null;
  endDate?: string | null;
}) {
  const [start, setStart] = useState(
    () => startDate ?? DateTime.now().setZone("Asia/Shanghai").toISODate()!,
  );
  const [end, setEnd] = useState(endDate ?? start);
  const [count, setCount] = useState(String(tripDayCount(start, end)));
  return (
    <>
      <div className="field-grid">
        <Label>
          开始日期
          <Input
            name="startDate"
            type="date"
            required
            value={start}
            onChange={(e) => {
              const date = e.target.value;
              setStart(date);
              if (date && Number(count) >= 1 && Number(count) <= MAX_TRIP_DAYS)
                setEnd(addDays(date, Number(count) - 1));
            }}
          />
        </Label>
        <Label>
          结束日期
          <Input
            name="endDate"
            type="date"
            required
            min={start}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setCount(
                e.target.value && start
                  ? String(tripDayCount(start, e.target.value))
                  : "",
              );
            }}
          />
        </Label>
      </div>
      <Label className="trip-duration-field">
        行程天数
        <Input
          name="dayCount"
          type="number"
          required
          min={1}
          max={MAX_TRIP_DAYS}
          value={count}
          onChange={(e) => {
            setCount(e.target.value);
            const n = Number(e.target.value);
            if (start && Number.isInteger(n) && n >= 1 && n <= MAX_TRIP_DAYS)
              setEnd(addDays(start, n - 1));
          }}
        />
      </Label>
    </>
  );
}
