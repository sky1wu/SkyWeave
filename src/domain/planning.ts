import { DateTime } from "luxon";
export const placeCategories = [
  "未分类",
  "景点",
  "餐饮",
  "住宿",
  "购物",
  "交通",
  "活动",
  "其他",
];
export function inferPlaceCategory(types: string[] = [], itemType?: string) {
  if (itemType === "hotel") return "住宿";
  if (itemType === "event") return "活动";
  if (itemType === "transport" || itemType === "border") return "交通";
  const categories: Record<string, string> = {
    "05": "餐饮",
    "06": "购物",
    "08": "活动",
    "10": "住宿",
    "11": "景点",
    "15": "交通",
  };
  for (const type of types)
    if (categories[type.slice(0, 2)]) return categories[type.slice(0, 2)];
  return "未分类";
}
export function nextDayDate(
  startDate: string | null,
  days: { date: string | null; position: number }[],
  fallbackDate: string,
): string {
  const ordered = [...days].sort((a, b) => a.position - b.position);
  for (let i = ordered.length - 1; i >= 0; i--)
    if (ordered[i].date)
      return DateTime.fromISO(ordered[i].date!)
        .plus({ days: ordered.length - i })
        .toISODate()!;
  return DateTime.fromISO(startDate ?? fallbackDate)
    .plus({ days: ordered.length })
    .toISODate()!;
}
