import type { DayPlan, Participant } from "./types";
import { calculateTripTimelines } from "./timeline";

/** Use the same personal paths as filtering; an unset field is a rule, not a roster. */
export function itemAttendance(
  days: DayPlan[],
  participants: Participant[],
  timelines = calculateTripTimelines(days),
) {
  const known = new Set(
    [...timelines.values()].flatMap((timeline) =>
      timeline.entries.flatMap(
        (entry) => entry.people?.map((p) => p.participantId) ?? [],
      ),
    ),
  );
  const branches = new Map(
    days.flatMap((day) =>
      day.items.flatMap((item) =>
        (item.parallelPlan?.branches ?? []).map(
          (branch) => [branch.id, branch] as const,
        ),
      ),
    ),
  );
  const everyone = participants
    .filter((p) => p.status === "active")
    .map((p) => p.id);
  const attendance = new Map<string, string[]>();
  for (const day of days) {
    const entries = new Map(
      timelines.get(day.id)?.entries.map((entry) => [entry.itemId, entry]),
    );
    for (const item of day.items) {
      const configured =
        item.participantIds ??
        (item.branchId
          ? branches.get(item.branchId)?.participantIds
          : undefined) ??
        everyone;
      const people = entries.get(item.id)?.people;
      const attending = new Set(
        people?.filter((p) => !p.skipped).map((p) => p.participantId),
      );
      // The linear clock and ungrouped travelers may have no individual timing rows.
      attendance.set(
        item.id,
        people === undefined
          ? configured
          : configured.filter((id) => !known.has(id) || attending.has(id)),
      );
    }
  }
  return attendance;
}

/** Preview the default rule without persisting an explicit list over it. */
export function automaticItemAttendance(
  itemId: string,
  days: DayPlan[],
  participants: Participant[],
) {
  const preview = days.map((day) => ({
    ...day,
    items: day.items.map((item) =>
      item.id === itemId ? { ...item, participantIds: null } : item,
    ),
  }));
  return itemAttendance(preview, participants).get(itemId);
}
