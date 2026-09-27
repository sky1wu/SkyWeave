import type { DayPlan, Item } from "./types";
import {
  calculateLinearTimeline,
  type TimelineEntry,
  type PersonTiming,
} from "./linear-timeline";
import { compilePlan, connectionKey, type PlanStep } from "./plan-graph";

type State = {
  clock: number | null;
  physical?: Item;
  prior?: TimelineEntry;
  first: boolean;
  approachOrigin?: {
    targetId: string;
    clock: number | null;
    physical?: Item;
    prior?: TimelineEntry;
    first: boolean;
  };
  redirect?: { target: string; branchId: string };
};
type Arrival = {
  person: string;
  step: PlanStep;
  entry: TimelineEntry;
  state: State;
  joinBranch?: string;
  joinPolicy?: "wait_all" | "fixed";
};
const latest = (values: (number | null)[]) =>
  values.length && values.every((v) => v !== null)
    ? Math.max(...(values as number[]))
    : null;
const earliest = (values: (number | null)[]) =>
  values.some((v) => v !== null)
    ? Math.min(...values.filter((v): v is number => v !== null))
    : null;
const unique = (values: string[]) => [...new Set(values)];

export function calculateTripTimelines(
  days: DayPlan[],
  participantId: string | null = null,
) {
  const result = new Map<
    string,
    {
      entries: TimelineEntry[];
      departures: Record<string, number | null>;
      activeLegIds?: string[];
    }
  >();
  if (!days.some((day) => day.items.some((item) => item.parallelPlan))) {
    for (const day of days) result.set(day.id, calculateLinearTimeline(day));
    return result;
  }
  const graph = compilePlan(days);
  const selectedPerson =
    participantId && graph.people.includes(participantId)
      ? participantId
      : null;
  const byDay = new Map(days.map((day) => [day.id, day]));
  const basePosition = Math.min(...days.map((day) => day.position));
  const offset = (dayId: string) =>
    (byDay.get(dayId)!.position - basePosition) * 86400;
  const absolute = (item: Item): Item => ({
    ...item,
    startMinutes:
      item.startMinutes === null
        ? null
        : item.startMinutes + offset(item.dayId) / 60,
    endMinutes:
      item.endMinutes === null
        ? null
        : item.endMinutes + offset(item.dayId) / 60,
  });
  const legs = new Map(
    days
      .flatMap((day) => day.legs)
      .map((leg) => [
        connectionKey(
          leg.fromItemId,
          leg.toItemId,
          leg.branchId ?? "",
          leg.routeRole ?? "main",
        ),
        leg,
      ]),
  );
  const visits = new Map<string, { person: string; step: PlanStep }[]>();
  for (const [person, path] of graph.paths)
    for (const step of path)
      visits.set(step.itemId, [
        ...(visits.get(step.itemId) ?? []),
        { person, step },
      ]);
  const states = new Map<string, State>();
  const entries = new Map<string, TimelineEntry>();
  const personal = new Map<string, Map<string, TimelineEntry>>();
  const departures: Record<string, number | null> = {};
  const personalDepartures = new Map<string, Record<string, number | null>>();
  const policies = new Map(
    [...graph.branches.values()]
      .filter((b) => b.joinId)
      .map((b) => [b.joinId!, b.policy]),
  );
  function empty(
    itemId: string,
    clock: number | null,
    first: boolean,
  ): TimelineEntry {
    return {
      itemId,
      arrival: null,
      start: clock,
      departure: clock,
      isDayStart: first,
      earlyMinutes: 0,
      lateMinutes: 0,
      warnings: [],
    };
  }
  function evaluate(
    item: Item,
    state: State,
    scope: string,
    person: string,
    role: "main" | "catch_up" = "main",
  ) {
    const day = byDay.get(item.dayId)!;
    const transformed = absolute(item);
    const key = state.physical
      ? connectionKey(state.physical.id, item.id, scope, role)
      : "";
    const leg = legs.get(key);
    const samePoint = state.physical?.id === item.id;
    const calculated = calculateLinearTimeline(
      {
        ...day,
        startMinutes: day.startMinutes + offset(day.id) / 60,
        items: [transformed],
        legs: leg ? [leg] : [],
      },
      {
        clock: state.clock,
        previous: samePoint
          ? undefined
          : state.physical
            ? absolute(state.physical)
            : undefined,
        prior: state.prior,
        hasArrival: samePoint || !state.first,
      },
    );
    if (leg) {
      const value = calculated.departures[leg.id];
      const own = personalDepartures.get(person) ?? {};
      own[leg.id] = value;
      personalDepartures.set(person, own);
      if (!(leg.id in departures)) departures[leg.id] = value;
      else departures[leg.id] = earliest([departures[leg.id], value]);
    }
    const entry = calculated.entries[0];
    if (
      state.physical?.dayId !== item.dayId &&
      !item.fixedTime &&
      !item.transport &&
      item.startMinutes === null &&
      entry.start !== null
    ) {
      const start = Math.max(
        entry.start,
        offset(item.dayId) + day.startMinutes * 60,
      );
      entry.start = start;
      entry.departure = start + item.stayMinutes * 60;
    }
    return entry;
  }
  for (const id of graph.order) {
    const item = graph.byId.get(id)!;
    const day = byDay.get(item.dayId)!;
    const arrivals: Arrival[] = [];
    const skipped: { person: string; entry: TimelineEntry }[] = [];
    for (const { person, step } of visits.get(id) ?? []) {
      let state = states.get(person) ?? {
        clock: offset(item.dayId) + day.startMinutes * 60,
        first: true,
      };
      if (state.redirect && state.redirect.target !== id) {
        const entry = {
          ...empty(id, null, false),
          skipped: true,
          catchUpTargetId: state.redirect.target,
          warnings: [
            `迟到后改赴「${graph.byId.get(state.redirect.target)!.title}」会合`,
          ],
        };
        skipped.push({ person, entry });
        continue;
      }
      if (step.reset && !state.redirect) {
        const anchor =
          offset(item.dayId) + (item.startMinutes ?? day.startMinutes) * 60;
        const delayed =
          !step.fork && state.clock !== null && state.clock > anchor;
        state = step.disconnected
          ? { clock: null, first: false }
          : { clock: delayed ? state.clock : anchor, first: !delayed };
      }
      states.set(person, state);
      if (item.parallelPlan) {
        if (step.fork?.startMinutes != null) {
          const start = offset(item.dayId) + step.fork.startMinutes * 60;
          state.clock = step.reset
            ? start
            : state.clock === null
              ? null
              : Math.max(state.clock, start);
        }
        const entry = empty(id, state.clock, state.first);
        arrivals.push({ person, step, entry, state });
        continue;
      }
      if (step.approach) {
        const target = graph.byId.get(step.approach.targetId)!;
        const original = {
          targetId: target.id,
          clock: state.clock,
          physical: state.physical,
          prior: state.prior,
          first: state.first,
        };
        const approach = evaluate(
          target,
          state,
          step.approach.join.branchId,
          person,
        );
        state.approachOrigin = original;
        state.clock = approach.arrival;
        state.physical = target;
        state.first = false;
      }
      const redirect = state.redirect;
      const scope = redirect?.branchId ?? step.join?.branchId ?? step.scope;
      const entry = evaluate(
        item,
        state,
        scope,
        person,
        redirect ? "catch_up" : "main",
      );
      if (
        !redirect &&
        step.join?.catchUpItemId &&
        item.startMinutes !== null &&
        entry.arrival !== null &&
        entry.arrival > offset(item.dayId) + item.startMinutes * 60
      ) {
        if (state.approachOrigin?.targetId === id) {
          const original = state.approachOrigin;
          state.clock = original.clock;
          state.physical = original.physical;
          state.prior = original.prior;
          state.first = original.first;
          state.approachOrigin = undefined;
        }
        const unused = legs.get(
          connectionKey(state.physical?.id ?? "", id, step.join.branchId),
        );
        if (unused) {
          const own = personalDepartures.get(person);
          if (own) delete own[unused.id];
        }
        state.redirect = {
          target: step.join.catchUpItemId,
          branchId: step.join.branchId,
        };
        const skippedEntry = {
          ...entry,
          start: null,
          departure: null,
          skipped: true,
          branchId: step.join.branchId,
          catchUpTargetId: step.join.catchUpItemId,
          warnings: [
            ...entry.warnings,
            `迟到后改赴「${graph.byId.get(step.join.catchUpItemId)!.title}」会合`,
          ],
        };
        skipped.push({ person, entry: skippedEntry });
        continue;
      }
      arrivals.push({
        person,
        step,
        entry,
        state,
        joinBranch:
          redirect?.branchId ??
          step.join?.branchId ??
          step.approach?.join.branchId,
        joinPolicy: redirect
          ? (policies.get(id) ?? "wait_all")
          : (step.join?.policy ?? step.approach?.join.policy),
      });
    }
    const gather = arrivals.some((a) => a.joinPolicy) || policies.has(id);
    const policy =
      policies.get(id) ??
      arrivals.find((a) => a.joinPolicy)?.joinPolicy ??
      "wait_all";
    const arrival = latest(arrivals.map((a) => a.entry.arrival));
    if (gather && policy === "wait_all" && !item.parallelPlan) {
      const ready = calculateLinearTimeline(
        { ...day, items: [absolute(item)], legs: [] },
        { clock: arrival, hasArrival: true },
      ).entries[0];
      for (const person of arrivals) {
        person.entry.start = arrival === null ? null : ready.start;
        person.entry.departure = arrival === null ? null : ready.departure;
        person.entry.warnings.push(
          ...ready.warnings.filter(
            (warning) => !warning.startsWith("预计迟到"),
          ),
        );
        if (arrival === null)
          person.entry.warnings.push("部分分组到达时间未知，集合时间待确认");
      }
    }
    const persons = new Map<string, TimelineEntry>();
    for (const row of arrivals) {
      row.entry.branchId = (row.joinBranch ?? row.step.scope) || undefined;
      row.entry.warnings = unique(row.entry.warnings);
      persons.set(row.person, row.entry);
      if (!item.parallelPlan) {
        row.state.clock = row.entry.departure;
        row.state.prior = row.entry;
        row.state.first = false;
        if (item.type !== "note") row.state.physical = item;
        row.state.redirect = undefined;
      }
    }
    for (const row of skipped) persons.set(row.person, row.entry);
    personal.set(id, persons);
    let primary: TimelineEntry = arrivals.length
      ? {
          ...arrivals[0].entry,
          arrival,
          start: earliest(arrivals.map((a) => a.entry.start)),
          departure: latest(arrivals.map((a) => a.entry.departure)),
          earlyMinutes: Math.min(...arrivals.map((a) => a.entry.earlyMinutes)),
          lateMinutes: Math.max(...arrivals.map((a) => a.entry.lateMinutes)),
          warnings: unique([
            ...arrivals.flatMap((a) => a.entry.warnings),
            ...skipped.flatMap((a) => a.entry.warnings),
          ]),
        }
      : {
          ...empty(id, null, false),
          warnings: skipped.flatMap((a) => a.entry.warnings),
        };
    if (
      gather &&
      policy === "fixed" &&
      item.startMinutes !== null &&
      !item.transport
    )
      primary = {
        ...primary,
        start: offset(item.dayId) + item.startMinutes * 60,
        departure:
          offset(item.dayId) +
          (item.endMinutes ?? item.startMinutes + item.stayMinutes) * 60,
      };
    if (gather && item.type !== "note") {
      const groups = new Map<string, Arrival[]>();
      for (const row of arrivals) {
        const key = row.joinBranch ?? row.step.scope;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      primary.rendezvous = {
        policy,
        arrivals: [...groups].map(([branchId, rows]) => {
          const arrived = latest(rows.map((row) => row.entry.arrival));
          return {
            branchId,
            title: graph.branches.get(branchId)?.title ?? "共同安排",
            participantIds: rows.map((r) => r.person),
            arrival: arrived,
            waitMinutes:
              arrived === null || primary.start === null
                ? null
                : Math.max(0, Math.ceil((primary.start - arrived) / 60)),
            lateMinutes:
              arrived === null || item.startMinutes === null
                ? null
                : Math.max(
                    0,
                    Math.ceil(
                      (arrived - offset(item.dayId) - item.startMinutes * 60) /
                        60,
                    ),
                  ),
          };
        }),
      };
      const redirected = new Map<string, typeof skipped>();
      for (const row of skipped) {
        const branch = row.entry.branchId ?? "";
        redirected.set(branch, [...(redirected.get(branch) ?? []), row]);
      }
      for (const [branchId, rows] of redirected)
        primary.rendezvous.arrivals.push({
          branchId,
          title: graph.branches.get(branchId)?.title ?? "追赶组",
          participantIds: rows.map((r) => r.person),
          arrival: latest(rows.map((r) => r.entry.arrival)),
          waitMinutes: 0,
          lateMinutes: Math.max(...rows.map((r) => r.entry.lateMinutes)),
          catchUpTitle: graph.byId.get(rows[0].entry.catchUpTargetId ?? "")
            ?.title,
        });
      for (const group of primary.rendezvous.arrivals)
        if (group.lateMinutes)
          primary.warnings.push(
            `${group.title}预计迟到 ${group.lateMinutes} 分钟`,
          );
    }
    entries.set(id, primary);
  }
  // Compare personal appointments, not unrelated groups that happen at the same time.
  for (const person of graph.people) {
    const windows = graph.all.flatMap((item) => {
      if (item.type === "note" || item.type === "parallel") return [];
      const entry = personal.get(item.id)?.get(person);
      if (!entry || entry.skipped) return [];
      const scheduled =
        (item.fixedTime || !!item.transport) && item.startMinutes !== null;
      const start = scheduled
        ? offset(item.dayId) + item.startMinutes! * 60
        : entry.start;
      const end =
        scheduled && item.endMinutes !== null
          ? offset(item.dayId) + item.endMinutes * 60
          : entry.departure;
      return start === null || end === null || end <= start
        ? []
        : [{ item, entry, start, end }];
    });
    for (let i = 0; i < windows.length; i++)
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i],
          b = windows[j];
        if (a.start < b.end && b.start < a.end) {
          a.entry.warnings.push(`与「${b.item.title}」时间重叠`);
          b.entry.warnings.push(`与「${a.item.title}」时间重叠`);
        }
      }
  }
  for (const day of days) {
    const shift = offset(day.id);
    const relative = (value: number | null) =>
      value === null ? null : value - shift;
    const normalized: TimelineEntry[] = day.items.map((item) => {
      const entry = entries.get(item.id) ?? empty(item.id, null, false);
      const people: PersonTiming[] = [...(personal.get(item.id) ?? [])].map(
        ([participantId, person]) => ({
          participantId,
          ...person,
          arrival: relative(person.arrival),
          start: relative(person.start),
          departure: relative(person.departure),
          warnings: unique(person.warnings),
        }),
      );
      const base = {
        ...entry,
        arrival: relative(entry.arrival),
        start: relative(entry.start),
        departure: relative(entry.departure),
        warnings: unique([
          ...entry.warnings,
          ...people.flatMap((p) => p.warnings),
        ]),
        people,
        ...(entry.rendezvous
          ? {
              rendezvous: {
                ...entry.rendezvous,
                arrivals: entry.rendezvous.arrivals.map((a) => ({
                  ...a,
                  arrival: relative(a.arrival),
                })),
              },
            }
          : {}),
      };
      const own = participantId
        ? people.find((person) => person.participantId === participantId)
        : undefined;
      return own ? { ...base, ...own, personal: true, people } : base;
    });
    const times = selectedPerson
      ? (personalDepartures.get(selectedPerson) ?? {})
      : departures;
    result.set(day.id, {
      entries: normalized,
      activeLegIds: day.legs
        .filter((leg) =>
          selectedPerson
            ? Object.hasOwn(
                personalDepartures.get(selectedPerson) ?? {},
                leg.id,
              )
            : [...personalDepartures.values()].some((times) =>
                Object.hasOwn(times, leg.id),
              ),
        )
        .map((leg) => leg.id),
      departures: Object.fromEntries(
        day.legs
          .filter((leg) => Object.hasOwn(times, leg.id))
          .map((leg) => [
            leg.id,
            times[leg.id] == null ? null : times[leg.id]! - shift,
          ]),
      ),
    });
  }
  return result;
}

export function calculateTimeline(
  day: DayPlan,
  days?: DayPlan[],
  participantId: string | null = null,
) {
  if (!days && day.contextDays) {
    const items = [...(day.contextItems ?? []), ...day.items],
      legs = [...(day.contextLegs ?? []), ...day.legs];
    days = day.contextDays.map((context) => ({
      ...day,
      ...context,
      items: items.filter((item) => item.dayId === context.id),
      legs: legs.filter((leg) => leg.dayId === context.id),
      contextItems: undefined,
      contextDays: undefined,
      contextLegs: undefined,
    }));
  }
  return calculateTripTimelines(days ?? [day], participantId).get(day.id)!;
}
