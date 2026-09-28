import type { DayPlan, Item } from "./types";
import type { PlanBranch } from "./parallel";

export type PlanDay = Pick<
  DayPlan,
  "id" | "position" | "startMinutes" | "items" | "participantIds"
>;
export interface BranchInfo extends PlanBranch {
  sectionId: string;
  parentBranchId: string | null;
  dayId: string;
  joinId: string | null;
  policy: "wait_all" | "fixed";
}
export interface JoinVisit {
  branchId: string;
  policy: "wait_all" | "fixed";
  catchUpItemId?: string | null;
}
export interface ParticipationStart {
  branchId: string;
  at: "departure" | "meeting";
  itemId: string;
  dayId: string;
  arrivalMinutes?: number | null;
  seedItemId?: string;
}
export interface PlanStep {
  itemId: string;
  scope: string;
  reset: boolean;
  disconnected?: boolean;
  fork?: BranchInfo;
  admission?: ParticipationStart;
  join?: JoinVisit;
  approach?: { targetId: string; join: JoinVisit };
}
export interface PlanConnection {
  from: Item;
  to: Item;
  branchId: string;
  routeRole: "main" | "catch_up";
  participantIds: string[];
}
export interface Recovery {
  at: string;
  target: string;
  origin: string;
  branchId: string;
}
export const connectionKey = (
  from: string,
  to: string,
  branch = "",
  role = "main",
) => JSON.stringify([from, to, branch, role]);

/** Compile each person's path first; shared item IDs are synchronization nodes. */
export function compilePlan(days: PlanDay[]) {
  const orderedDays = [...days].sort((a, b) => a.position - b.position);
  const dayIndex = new Map(orderedDays.map((day) => [day.id, day]));
  const all = orderedDays.flatMap((day) =>
    [...day.items].sort((a, b) => a.position - b.position),
  );
  const byId = new Map(all.map((item) => [item.id, item]));
  const scopes = new Map<string, Item[]>();
  for (const item of all) {
    const scope = item.branchId ?? "";
    const items = scopes.get(scope) ?? [];
    items.push(item);
    scopes.set(scope, items);
  }
  const branches = new Map<string, BranchInfo>();
  for (const item of all)
    for (const branch of item.parallelPlan?.branches ?? []) {
      branches.set(branch.id, {
        ...branch,
        sectionId: item.id,
        parentBranchId: item.branchId ?? null,
        dayId: item.dayId,
        joinId:
          branch.joinItemId === undefined
            ? item.parallelPlan!.joinItemId
            : branch.joinItemId,
        policy: branch.joinPolicy ?? item.parallelPlan!.joinPolicy,
      });
    }
  const hasItemParticipants = all.some((item) => item.participantIds != null);
  const people = [
    ...new Set(
      [...branches.values()]
        .flatMap((b) => b.participantIds)
        .concat(
          hasItemParticipants ||
            [...branches.values()].some((branch) => branch.entrants?.length)
            ? orderedDays.flatMap((day) => day.participantIds ?? [])
            : [],
          all.flatMap((item) => item.participantIds ?? []),
        ),
    ),
  ];
  if (!people.length) people.push("__all__");
  const paths = new Map<string, PlanStep[]>();
  const admissions = new Map<string, ParticipationStart>();
  for (const person of people) {
    const visiting = new Set<string>();
    function walk(scope: string): PlanStep[] {
      if (visiting.has(scope)) throw new Error("分组不能形成循环嵌套");
      visiting.add(scope);
      const list = scopes.get(scope) ?? [];
      const result: PlanStep[] = [];
      let index = 0,
        carry = scope,
        forceReset = false;
      let pending: JoinVisit | undefined;
      while (index < list.length) {
        const item = list[index];
        if (!item.parallelPlan) {
          if (item.participantIds && !item.participantIds.includes(person)) {
            index++;
            continue;
          }
          const previous = result.at(-1);
          const newDay =
            !scope &&
            !pending &&
            previous &&
            byId.get(previous.itemId)!.dayId !== item.dayId;
          if (newDay) carry = scope;
          result.push({
            itemId: item.id,
            scope: pending?.branchId ?? carry,
            reset: forceReset || !!newDay,
            disconnected:
              forceReset &&
              !!previous &&
              byId.get(previous.itemId)!.dayId === item.dayId,
            ...(pending ? { join: pending } : {}),
          });
          pending = undefined;
          forceReset = false;
          index++;
          continue;
        }
        const selected = item.parallelPlan.branches.find((b) =>
          b.participantIds.includes(person),
        );
        if (!selected) {
          const previous = result.at(-1);
          result.push({
            itemId: item.id,
            scope,
            reset:
              !scope &&
              !!previous &&
              byId.get(previous.itemId)!.dayId !== item.dayId,
          });
          index++;
          continue;
        }
        const branch = branches.get(selected.id)!;
        result.push({
          itemId: item.id,
          scope,
          reset:
            branch.departureItemId !== undefined ||
            !item.parallelPlan.splitItemId,
          fork: branch,
        });
        forceReset = false;
        result.push(...walk(branch.id));
        if (branch.joinId) {
          const at = list.findIndex(
            (candidate) => candidate.id === branch.joinId,
          );
          if (at <= index)
            throw new Error("集合点必须位于行动段之后，并属于同一层安排");
          pending = {
            branchId: branch.id,
            policy: branch.policy,
            catchUpItemId: branch.catchUpItemId,
          };
          const notes = list
            .slice(index + 1, at)
            .filter(
              (candidate) =>
                candidate.type === "note" &&
                (!candidate.participantIds ||
                  candidate.participantIds.includes(person)),
            );
          for (const [noteIndex, note] of notes.entries())
            result.push({
              itemId: note.id,
              scope: branch.id,
              reset: false,
              ...(noteIndex === 0
                ? { approach: { targetId: branch.joinId, join: pending } }
                : {}),
            });
          carry = branch.policy === "fixed" ? branch.id : scope;
          index = at;
        } else {
          const lastDay = Math.max(
            ...result.map(
              (step) => dayIndex.get(byId.get(step.itemId)!.dayId)!.position,
            ),
          );
          const at = list.findIndex(
            (candidate, i) =>
              i > index && dayIndex.get(candidate.dayId)!.position >= lastDay,
          );
          if (at < 0) break;
          index = at;
          forceReset = true;
          carry = scope;
        }
      }
      visiting.delete(scope);
      return result;
    }
    const fullPath = walk("");
    const admissionCandidates = [...branches.values()]
      .flatMap((branch) => {
        const entrant = branch.entrants?.find(
          (entrant) => entrant.participantId === person,
        );
        const forkIndex = fullPath.findIndex(
          (step) => step.fork?.id === branch.id,
        );
        if (!entrant || forkIndex < 0) return [];
        const section = byId.get(branch.sectionId)!;
        const shared =
          branch.departureItemId === undefined
            ? section.parallelPlan!.splitItemId
            : null;
        let index = forkIndex,
          boundary = section,
          seedItemId: string | undefined;
        if (entrant.at === "meeting") {
          index = fullPath.findIndex(
            (step, i) => i > forkIndex && step.itemId === branch.joinId,
          );
          if (index < 0)
            throw new Error(`「${branch.title}」没有可加入的集合点`);
          boundary = byId.get(fullPath[index].itemId)!;
        } else if (shared) {
          boundary = byId.get(shared)!;
          seedItemId = shared;
        } else {
          const at = fullPath.findIndex((step, i) => {
            if (i <= forkIndex) return false;
            const candidate = byId.get(step.itemId)!;
            if (candidate.type === "note" || candidate.type === "parallel")
              return false;
            let owner = candidate.branchId;
            while (owner) {
              if (owner === branch.id) return true;
              owner = branches.get(owner)?.parentBranchId;
            }
            return false;
          });
          if (at >= 0) {
            index = at;
            boundary = byId.get(fullPath[at].itemId)!;
          }
        }
        return [
          {
            index,
            forkIndex,
            rule: {
              branchId: branch.id,
              at: entrant.at,
              itemId: boundary.id,
              dayId: boundary.dayId,
              arrivalMinutes: entrant.arrivalMinutes,
              seedItemId,
            } satisfies ParticipationStart,
          },
        ];
      })
      .sort((a, b) => a.index - b.index);
    const admission = admissionCandidates[0];
    let path = fullPath;
    const ancestorBranches = new Set<string>();
    if (admission) {
      admissions.set(person, admission.rule);
      let ancestor = branches.get(admission.rule.branchId)?.parentBranchId;
      while (ancestor) {
        ancestorBranches.add(ancestor);
        ancestor = branches.get(ancestor)?.parentBranchId;
      }
      path = fullPath.slice(admission.index).map((step) => ({ ...step }));
      if (
        admission.rule.at === "departure" &&
        admission.index > admission.forkIndex
      )
        path.unshift({
          ...fullPath[admission.forkIndex],
          reset: true,
          admission: admission.rule,
        });
      else
        path[0] = {
          ...path[0],
          reset: false,
          admission: admission.rule,
          ...(admission.rule.at === "meeting" && path[0].join
            ? { join: { ...path[0].join, catchUpItemId: undefined } }
            : {}),
        };
    }
    const meetingEntries = new Set<string>();
    // Joining at a meeting also applies to later sections after the first admission.
    for (let i = 0; i < path.length; i++) {
      const branch = path[i].fork;
      const entrant = branch?.entrants?.find(
        (entrant) =>
          entrant.participantId === person && entrant.at === "meeting",
      );
      if (!branch || !entrant) continue;
      const at = path.findIndex(
        (step, index) => index > i && step.itemId === branch.joinId,
      );
      if (at < 0) throw new Error(`「${branch.title}」没有可加入的集合点`);
      const join = byId.get(path[at].itemId)!;
      const step = {
        ...path[at],
        reset: false,
        admission: {
          branchId: branch.id,
          at: "meeting" as const,
          itemId: join.id,
          dayId: join.dayId,
          arrivalMinutes: entrant.arrivalMinutes,
        },
        ...(path[at].join
          ? { join: { ...path[at].join!, catchUpItemId: undefined } }
          : {}),
      };
      for (const skipped of path.slice(i, at))
        if (skipped.fork) meetingEntries.add(skipped.fork.id);
      path.splice(i, at - i + 1, step);
      meetingEntries.add(branch.id);
    }
    const unique = new Set(path.map((step) => step.itemId));
    if (unique.size !== path.length)
      throw new Error("同一人的路径不能重复经过同一个事项");
    for (const branch of branches.values())
      if (
        branch.participantIds.includes(person) &&
        !path.some((step) => step.fork?.id === branch.id) &&
        branch.id !== admission?.rule.branchId &&
        !ancestorBranches.has(branch.id) &&
        !meetingEntries.has(branch.id) &&
        !(
          admission &&
          ((fullPath.findIndex((step) => step.fork?.id === branch.id) >= 0 &&
            fullPath.findIndex((step) => step.fork?.id === branch.id) <
              admission.index) ||
            dayIndex.get(branch.dayId)!.position <
              dayIndex.get(admission.rule.dayId)!.position)
        )
      ) {
        throw new Error(
          "同一人的分头行动段时间范围重叠，请调整集合点或使用嵌套分组",
        );
      }
    paths.set(person, path);
  }
  const edges = new Map<string, Set<string>>();
  const indegree = new Map(all.map((item) => [item.id, 0]));
  const addEdge = (from: string, to: string) => {
    if (from === to) throw new Error("行程路径不能连接到自身");
    const next = edges.get(from) ?? new Set<string>();
    if (!next.has(to)) {
      next.add(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
    edges.set(from, next);
  };
  const routes = new Map<string, PlanConnection>();
  const recoveries = new Map<string, Recovery[]>();
  function route(
    from: Item,
    to: Item,
    branchId: string,
    person: string,
    routeRole: PlanConnection["routeRole"] = "main",
  ) {
    const key = connectionKey(from.id, to.id, branchId, routeRole);
    const existing = routes.get(key);
    if (existing) {
      if (!existing.participantIds.includes(person))
        existing.participantIds.push(person);
    } else
      routes.set(key, {
        from,
        to,
        branchId,
        routeRole,
        participantIds: [person],
      });
  }
  for (const [person, path] of paths) {
    let physical: Item | undefined;
    const approachOrigins = new Map<string, Item>();
    for (const [index, step] of path.entries()) {
      const item = byId.get(step.itemId)!;
      if (index) addEdge(path[index - 1].itemId, item.id);
      if (step.reset) physical = undefined;
      if (step.admission?.seedItemId) {
        physical = byId.get(step.admission.seedItemId);
        if (physical && physical.id !== item.id) addEdge(physical.id, item.id);
      }
      if (step.fork) {
        const section = byId.get(step.fork.sectionId)!;
        const split =
          step.fork.departureItemId === undefined
            ? section.parallelPlan!.splitItemId
            : null;
        if (split && physical?.id !== split)
          throw new Error(
            `「${section.title}」中「${step.fork.title}」的共同出发点「${byId.get(split)?.title ?? "未命名地点"}」与实际前一地点不一致；请为本组选择独立出发地点，或调整共同出发点`,
          );
      }
      if (step.approach) {
        const target = byId.get(step.approach.targetId)!;
        if (physical) {
          route(physical, target, step.approach.join.branchId, person);
          approachOrigins.set(target.id, physical);
        }
        physical = target;
      }
      if (item.type === "parallel" || item.type === "note") continue;
      if (physical && physical.id !== item.id)
        route(physical, item, step.join?.branchId ?? step.scope, person);
      if (physical && step.join?.catchUpItemId) {
        const target = byId.get(step.join.catchUpItemId);
        const targetIndex = path.findIndex(
          (candidate) => candidate.itemId === target?.id,
        );
        if (
          !target ||
          targetIndex <= index ||
          target.type === "parallel" ||
          target.type === "note"
        )
          throw new Error("追赶集合点必须位于原集合点之后的个人路径中");
        const origin = approachOrigins.get(item.id) ?? physical;
        route(origin, target, step.join.branchId, person, "catch_up");
        addEdge(origin.id, target.id);
        const recovery = {
          at: item.id,
          target: target.id,
          origin: origin.id,
          branchId: step.join.branchId,
        };
        recoveries.set(person, [...(recoveries.get(person) ?? []), recovery]);
      }
      physical = item;
    }
  }
  const queue = all
    .filter((item) => indegree.get(item.id) === 0)
    .map((item) => item.id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const next of edges.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== all.length)
    throw new Error("行程包含互相等待的循环，请调整分开点或集合点");
  const ranks = new Map(order.map((id, i) => [id, i]));
  const connections = [...routes.values()].sort(
    (a, b) =>
      ranks.get(a.to.id)! - ranks.get(b.to.id)! ||
      Number(a.routeRole === "catch_up") - Number(b.routeRole === "catch_up"),
  );
  return {
    all,
    byId,
    dayIndex,
    branches,
    people,
    paths,
    order,
    connections,
    recoveries,
    admissions,
  };
}
