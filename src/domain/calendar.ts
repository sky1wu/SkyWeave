import { DateTime } from "luxon";

export const MAX_TRIP_DAYS = 366;
export const dayTitle = (position: number) => `第 ${position + 1} 天`;
export function addDays(date: string, count: number) {
  return DateTime.fromISO(date, { zone: "UTC" })
    .plus({ days: count })
    .toISODate()!;
}
export function tripDayCount(start: string, end: string) {
  return (
    Math.round(
      DateTime.fromISO(end, { zone: "UTC" }).diff(
        DateTime.fromISO(start, { zone: "UTC" }),
        "days",
      ).days,
    ) + 1
  );
}
export function tripDates(start: string, end: string) {
  const count = tripDayCount(start, end);
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRIP_DAYS)
    throw new Error(`行程天数须为 1–${MAX_TRIP_DAYS} 天`);
  return Array.from({ length: count }, (_, position) =>
    addDays(start, position),
  );
}
