"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { DropTarget } from "./planner/types";
import { GitFork, MapPin, Plus, Users } from "lucide-react";
import type { DayPlan, Item, Participant, PoolPlace } from "@/domain/types";
import {
  branchColors,
  branchesOf,
  contextualDays,
  planningItems,
  sectionDescendants,
  displayItems,
  type ParallelPlan,
  type PlanBranch,
} from "@/domain/parallel";
import { formatTime, type TimelineEntry } from "@/domain/timeline";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { NativeSelect } from "./ui/native-select";
import { ErrorText, Modal } from "./ui";
import { TimeField } from "./item-editor";
import {
  BranchDeparture,
  departureDay,
  type DepartureDraft,
} from "./branch-departure";

function newBranchId() {
  // getRandomValues also works on self-hosted HTTP origins.
  return `branch-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function ParticipantFilter({
  participants,
  currentUserId,
  value,
  onChange,
}: {
  participants: Participant[];
  currentUserId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const mine = participants.find((p) => p.userId === currentUserId);
  return (
    <label className="participant-filter">
      <Users size={15} />
      <span>查看行程</span>
      <NativeSelect
        aria-label="查看谁的行程"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部同行者</option>
        <option value="me" disabled={!mine}>
          我的行程{!mine ? "（尚未关联同行者）" : ""}
        </option>
        {participants.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

export function ParticipationNote({
  days,
  start,
}: {
  days: DayPlan[];
  start?: { dayId: string; itemId: string; at: "departure" | "meeting" };
}) {
  if (!start) return null;
  const day = days.find((day) => day.id === start.dayId),
    item = days
      .flatMap((day) => day.items)
      .find((item) => item.id === start.itemId);
  return (
    <p className="participation-note">
      {day?.title} ·{" "}
      {start.at === "meeting"
        ? `在「${item?.title ?? "集合点"}」加入`
        : `从「${item?.title ?? "本组出发地"}」开始参与`}
      ；此前安排不计入个人行程。
    </p>
  );
}

export function ParallelEditor({
  day,
  days = [day],
  item,
  initial,
  parentBranchId,
  participants,
  pool = [],
  close,
  save,
}: {
  day: DayPlan;
  days?: DayPlan[];
  item?: Item;
  initial?: { splitItemId: string | null; joinItemId: string | null };
  parentBranchId?: string | null;
  pool?: PoolPlace[];
  participants: Participant[];
  close: () => void;
  save: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const all = days.flatMap((d) => d.items);
  const parentId = item?.branchId ?? parentBranchId ?? null;
  const parent = all
    .flatMap((i) => i.parallelPlan?.branches ?? [])
    .find((b) => b.id === parentId);
  const people = participants.filter(
    (p) =>
      (!parent || parent.participantIds.includes(p.id)) &&
      (p.status === "active" ||
        item?.parallelPlan?.branches.some((b) =>
          b.participantIds.includes(p.id),
        )),
  );
  const [title, setTitle] = useState(item?.title ?? "分头行动");
  const [plan, setPlan] = useState<ParallelPlan>(
    () =>
      item?.parallelPlan ?? {
        splitItemId: initial?.splitItemId ?? null,
        joinItemId: initial?.joinItemId ?? null,
        joinPolicy: "wait_all",
        branches: [0, 1].map((i) => ({
          id: newBranchId(),
          title: `${i + 1} 组`,
          participantIds: people[i] ? [people[i].id] : [],
          startMinutes: null,
        })),
      },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [departures, setDepartures] = useState<
    Record<string, DepartureDraft | undefined>
  >({});
  const [selected, setSelected] = useState<string[]>([]),
    [batchBranch, setBatchBranch] = useState(plan.branches[0].id),
    [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const scope = all.filter(
    (i) => i.id !== item?.id && (i.branchId ?? null) === parentId,
  );
  const options = scope.filter(
    (i) => i.type !== "parallel" && i.type !== "note",
  );
  const dayLabel = (id: string) => days.find((d) => d.id === id)?.title ?? "";
  const label = (i: Item) => `${dayLabel(i.dayId)} · ${i.title}`;
  const endpoints = new Set([
    plan.splitItemId,
    plan.joinItemId,
    ...plan.branches.flatMap((b) => [b.joinItemId, b.catchUpItemId]),
  ]);
  const candidates = all.filter(
    (i) =>
      i.id !== item?.id &&
      !endpoints.has(i.id) &&
      ((i.branchId ?? null) === parentId ||
        plan.branches.some((b) => b.id === i.branchId)),
  );
  const unassigned = people.filter(
    (p) => !plan.branches.some((b) => b.participantIds.includes(p.id)),
  );
  const updateBranch = (id: string, data: Partial<PlanBranch>) => {
    setError("");
    setPlan((current) => ({
      ...current,
      branches: current.branches.map((branch) =>
        branch.id === id ? { ...branch, ...data } : branch,
      ),
    }));
  };
  function changeOrigin(
    branch: PlanBranch,
    draft: DepartureDraft | undefined,
    itemId: string | null | undefined,
    dayId: string,
  ) {
    const oldDay = departureDay(branch, departures[branch.id], day, days),
      nextDay = days.find((d) => d.id === dayId)!;
    const shift = (nextDay.position - oldDay.position) * 1440;
    updateBranch(branch.id, {
      departureItemId: itemId,
      startMinutes:
        branch.startMinutes == null
          ? null
          : Math.max(0, branch.startMinutes + shift),
    });
    setDepartures((current) => ({ ...current, [branch.id]: draft }));
  }
  const locationOptions = options.map((i) => (
    <option key={i.id} value={i.id}>
      {label(i)}
    </option>
  ));
  return (
    <Modal title={item ? "编辑分头行动" : "添加分头行动"} close={close}>
      <form
        className="parallel-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (plan.branches.some((b) => !b.participantIds.length))
              throw new Error(
                "请为每一组选择至少一位同行者；可以先在成员页添加同行者。",
              );
            await save({
              title,
              parallelPlan: plan,
              branchId: parentId,
              ...(item ? { expectedVersion: item.version } : {}),
              departures: Object.entries(departures).flatMap(
                ([branchId, draft]) =>
                  draft &&
                  plan.branches.some((branch) => branch.id === branchId)
                    ? [{ branchId, ...draft }]
                    : [],
              ),
              assignments: Object.entries(assignments).map(
                ([itemId, branchId]) => ({
                  itemId,
                  branchId,
                  expectedVersion: all.find((i) => i.id === itemId)!.version,
                }),
              ),
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm muted">
          为同一段行程安排多组路线，并设置各自出发和集合地点。只有一条安排需要选人时，可直接点击事项卡片上的“谁参加”。
        </p>
        <ErrorText error={error} />
        {parent && (
          <p className="parallel-boundary">
            在「{parent.title}」内再次分组，成员从上一级分组中选择。
          </p>
        )}
        <Label>
          行动段名称
          <Input
            value={title}
            onChange={(e) => {
              setError("");
              setTitle(e.target.value);
            }}
            required
            maxLength={200}
          />
        </Label>
        <div className="field-grid">
          <Label>
            默认出发地点
            <NativeSelect
              aria-label="分开地点"
              value={plan.splitItemId ?? ""}
              onChange={(e) => {
                setError("");
                setPlan({ ...plan, splitItemId: e.target.value || null });
              }}
            >
              <option value="">各自出发</option>
              {locationOptions}
            </NativeSelect>
          </Label>
          <Label>
            默认集合地点
            <NativeSelect
              aria-label="集合地点"
              value={plan.joinItemId ?? ""}
              onChange={(e) => {
                setError("");
                setPlan({ ...plan, joinItemId: e.target.value || null });
              }}
            >
              <option value="">各自结束，不集合</option>
              {locationOptions}
            </NativeSelect>
          </Label>
        </div>
        <p className="text-xs muted">
          每组可单独选择出发地点和集合地点。中途加入的成员可在组内设置参与起点；集合点也可选后续日期。
        </p>
        <Label>
          默认集合规则
          <NativeSelect
            aria-label="默认集合规则"
            value={plan.joinPolicy}
            onChange={(e) =>
              setPlan({
                ...plan,
                joinPolicy: e.target.value as ParallelPlan["joinPolicy"],
              })
            }
          >
            <option value="wait_all">等齐再走</option>
            <option value="fixed">按固定时间开始</option>
          </NativeSelect>
        </Label>
        <div className="parallel-editor-groups">
          {plan.branches.map((branch, index) => {
            const joinId =
              branch.joinItemId === undefined
                ? plan.joinItemId
                : branch.joinItemId;
            const joinIndex = options.findIndex((i) => i.id === joinId);
            const fixed = (branch.joinPolicy ?? plan.joinPolicy) === "fixed";
            const originDay = departureDay(
              branch,
              departures[branch.id],
              day,
              days,
            );
            const originOffset = (originDay.position - day.position) * 1440;
            return (
              <fieldset
                key={branch.id}
                style={
                  { "--branch-color": branchColors[index] } as CSSProperties
                }
              >
                <legend>{index + 1} 组</legend>
                <Label>
                  组名
                  <Input
                    aria-label={`第 ${index + 1} 组名称`}
                    value={branch.title}
                    maxLength={80}
                    required
                    onChange={(e) =>
                      updateBranch(branch.id, { title: e.target.value })
                    }
                  />
                </Label>
                <div className="parallel-people">
                  {people.map((person) => (
                    <Label key={person.id} className="flex items-center gap-2">
                      <Checkbox
                        aria-label={branch.title}
                        checked={branch.participantIds.includes(person.id)}
                        disabled={plan.branches.some(
                          (b) =>
                            b.id !== branch.id &&
                            b.participantIds.includes(person.id),
                        )}
                        onCheckedChange={(checked) =>
                          updateBranch(branch.id, {
                            participantIds: checked
                              ? [...branch.participantIds, person.id]
                              : branch.participantIds.filter(
                                  (id) => id !== person.id,
                                ),
                            entrants: checked
                              ? branch.entrants
                              : branch.entrants?.filter(
                                  (entrant) =>
                                    entrant.participantId !== person.id,
                                ),
                          })
                        }
                      />
                      {person.name}
                    </Label>
                  ))}
                </div>
                {!people.length && (
                  <p className="text-xs muted">请先在成员页添加同行者。</p>
                )}
                <BranchDeparture
                  branch={branch}
                  day={day}
                  days={days}
                  pool={pool}
                  shared={all.find((item) => item.id === plan.splitItemId)}
                  draft={departures[branch.id]}
                  onChange={(draft, itemId, dayId) =>
                    changeOrigin(branch, draft, itemId, dayId)
                  }
                />
                <TimeField
                  name={`branch-${branch.id}`}
                  label={`${branch.title}出发时间`}
                  value={
                    branch.startMinutes == null
                      ? null
                      : Math.max(0, branch.startMinutes - originOffset)
                  }
                  onChange={(startMinutes) =>
                    updateBranch(branch.id, {
                      startMinutes:
                        startMinutes == null
                          ? null
                          : startMinutes + originOffset,
                    })
                  }
                />
                <p className="text-xs muted">
                  留空时使用
                  {branch.departureItemId === undefined &&
                  !departures[branch.id] &&
                  plan.splitItemId
                    ? "共同出发地点的离开时间"
                    : "所选起点当天的开始时间"}
                  。
                </p>
                <details
                  className="branch-entrants"
                  open={!!branch.entrants?.length}
                >
                  <summary>成员加入时间 · 可设置中途参加</summary>
                  <p className="text-xs muted">
                    同组成员可在不同阶段加入；加入前的安排不会出现在其个人行程中。
                  </p>
                  {people
                    .filter((person) =>
                      branch.participantIds.includes(person.id),
                    )
                    .map((person) => {
                      const entrant = branch.entrants?.find(
                        (entry) => entry.participantId === person.id,
                      );
                      return (
                        <div className="branch-entrant" key={person.id}>
                          <Label>
                            {person.name}
                            <NativeSelect
                              aria-label={`${branch.title} ${person.name}参与范围`}
                              value={entrant?.at ?? "all"}
                              onChange={(e) => {
                                const remaining =
                                  branch.entrants?.filter(
                                    (entry) =>
                                      entry.participantId !== person.id,
                                  ) ?? [];
                                updateBranch(branch.id, {
                                  entrants:
                                    e.target.value === "all"
                                      ? remaining
                                      : [
                                          ...remaining,
                                          {
                                            participantId: person.id,
                                            at: e.target.value as
                                              "departure" | "meeting",
                                          },
                                        ],
                                });
                              }}
                            >
                              <option value="all">全程同行</option>
                              <option value="departure">
                                从本组出发地加入
                              </option>
                              <option value="meeting" disabled={!joinId}>
                                直接在集合点加入
                              </option>
                            </NativeSelect>
                          </Label>
                          {entrant?.at === "meeting" && (
                            <>
                              <TimeField
                                name={`arrival-${person.id}-${branch.id}`}
                                label={`${person.name}到达集合点时间`}
                                value={entrant.arrivalMinutes ?? null}
                                onChange={(arrivalMinutes) =>
                                  updateBranch(branch.id, {
                                    entrants: branch.entrants!.map((entry) =>
                                      entry.participantId === person.id
                                        ? { ...entry, arrivalMinutes }
                                        : entry,
                                    ),
                                  })
                                }
                              />
                              <p className="text-xs muted">
                                按集合点当天计算；留空使用约定集合时间，没有约定则为待定。
                              </p>
                            </>
                          )}
                        </div>
                      );
                    })}
                </details>
                <Label>
                  本组集合地点
                  <NativeSelect
                    aria-label={`${branch.title}集合地点`}
                    value={
                      branch.joinItemId === undefined
                        ? "inherit"
                        : (branch.joinItemId ?? "none")
                    }
                    onChange={(e) =>
                      updateBranch(branch.id, {
                        joinItemId:
                          e.target.value === "inherit"
                            ? undefined
                            : e.target.value === "none"
                              ? null
                              : e.target.value,
                        catchUpItemId: null,
                      })
                    }
                  >
                    <option value="inherit">使用默认集合地点</option>
                    <option value="none">本组各自结束</option>
                    {locationOptions}
                  </NativeSelect>
                </Label>
                {joinId && (
                  <Label>
                    本组集合规则
                    <NativeSelect
                      aria-label={`${branch.title}集合规则`}
                      value={branch.joinPolicy ?? "inherit"}
                      onChange={(e) =>
                        updateBranch(branch.id, {
                          joinPolicy:
                            e.target.value === "inherit"
                              ? undefined
                              : (e.target.value as "wait_all" | "fixed"),
                          catchUpItemId: null,
                        })
                      }
                    >
                      <option value="inherit">使用默认规则</option>
                      <option value="wait_all">等齐再走</option>
                      <option value="fixed">按固定时间开始</option>
                    </NativeSelect>
                  </Label>
                )}
                {fixed && joinId && (
                  <Label>
                    迟到后如何会合
                    <NativeSelect
                      aria-label={`${branch.title}迟到后会合点`}
                      value={branch.catchUpItemId ?? ""}
                      onChange={(e) =>
                        updateBranch(branch.id, {
                          catchUpItemId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">继续原路径，独立计算迟到时间</option>
                      {options.slice(joinIndex + 1).map((i) => (
                        <option key={i.id} value={i.id}>
                          改赴 {label(i)}
                        </option>
                      ))}
                    </NativeSelect>
                    <span className="text-xs muted">
                      预计迟到时直接前往所选地点，跳过中间安排；追赶路线可单独选择交通方式。
                    </span>
                  </Label>
                )}
                {plan.branches.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={all.some((i) => i.branchId === branch.id)}
                    onClick={() =>
                      setPlan({
                        ...plan,
                        branches: plan.branches.filter(
                          (b) => b.id !== branch.id,
                        ),
                      })
                    }
                  >
                    移除空分组
                  </Button>
                )}
              </fieldset>
            );
          })}
        </div>
        {unassigned.length > 0 && (
          <p className="parallel-unassigned">
            本段暂未安排：{unassigned.map((p) => p.name).join("、")}
          </p>
        )}
        {candidates.length > 0 && (
          <details className="parallel-batch">
            <summary>批量分配已有安排（{candidates.length} 项）</summary>
            <p className="text-xs muted">
              勾选一段现有安排，选择分组后一起分配。保存时一次生效。
            </p>
            <div className="parallel-batch-toolbar">
              <Label className="flex items-center gap-2">
                <Checkbox
                  aria-label="选择全部可分配事项"
                  checked={selected.length === candidates.length}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? candidates.map((i) => i.id) : [])
                  }
                />
                全选
              </Label>
              <NativeSelect
                aria-label="批量目标分组"
                value={batchBranch}
                onChange={(e) => setBatchBranch(e.target.value)}
              >
                {plan.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                disabled={!selected.length}
                onClick={() => {
                  setAssignments((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      selected.map((id) => [id, batchBranch]),
                    ),
                  }));
                  setSelected([]);
                }}
              >
                分配所选 {selected.length} 项
              </Button>
            </div>
            <div className="parallel-batch-items">
              {candidates.map((candidate) => (
                <div key={candidate.id}>
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`选择 ${candidate.title}`}
                      checked={selected.includes(candidate.id)}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? [...selected, candidate.id]
                            : selected.filter((id) => id !== candidate.id),
                        )
                      }
                    />
                    {label(candidate)}
                  </Label>
                  <NativeSelect
                    aria-label={`${candidate.title}所属分组`}
                    value={
                      Object.hasOwn(assignments, candidate.id)
                        ? (assignments[candidate.id] ?? "common")
                        : "keep"
                    }
                    onChange={(e) =>
                      setAssignments((current) => {
                        const next = { ...current };
                        if (e.target.value === "keep")
                          delete next[candidate.id];
                        else
                          next[candidate.id] =
                            e.target.value === "common"
                              ? parentId
                              : e.target.value;
                        return next;
                      })
                    }
                  >
                    <option value="keep">保留现状</option>
                    <option value="common">
                      {parent ? "回到上一级安排" : "共同安排"}
                    </option>
                    {plan.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="actions">
          <Button
            type="button"
            disabled={busy || plan.branches.length >= 8}
            onClick={() =>
              setPlan({
                ...plan,
                branches: [
                  ...plan.branches,
                  {
                    id: newBranchId(),
                    title: `${plan.branches.length + 1} 组`,
                    participantIds: [],
                    startMinutes: null,
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            添加分组
          </Button>
          <Button type="submit" className="btn primary" disabled={busy}>
            {busy ? "保存中…" : "保存分头行动"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ParallelTransferEditor({
  section,
  days,
  operation,
  close,
  save,
}: {
  section: Item;
  days: DayPlan[];
  operation: "copy" | "move";
  close: () => void;
  save: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const all = days.flatMap((day) => day.items),
    included = sectionDescendants(all, section.id);
  for (const item of all.filter((item) => included.has(item.id)))
    if (item.parallelPlan)
      for (const id of [
        item.parallelPlan.splitItemId,
        item.parallelPlan.joinItemId,
        ...item.parallelPlan.branches.flatMap((b) => [
          b.joinItemId,
          b.catchUpItemId,
        ]),
      ])
        if (id) included.add(id);
  const items = all.filter((item) => included.has(item.id));
  const source = days.find((day) => day.id === section.dayId)!;
  const [targetDayId, setTargetDayId] = useState(source.id),
    [targetBranchId, setTargetBranchId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const title = operation === "copy" ? "复制整段" : "移动整段";
  const branches = branchesOf(contextualDays(days)[0]).filter(
    (b) => !included.has(b.sectionId),
  );
  return (
    <Modal title={`${title}：${section.title}`} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await save({
              sectionId: section.id,
              operation,
              targetDayId,
              targetBranchId: targetBranchId || null,
              expectedDays: days.map((day) => ({
                id: day.id,
                expectedVersion: day.version,
              })),
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorText error={error} />
        <Label>
          目标起始日期
          <NativeSelect
            aria-label="目标起始日期"
            value={targetDayId}
            onChange={(e) => setTargetDayId(e.target.value)}
          >
            {days.map((day) => (
              <option
                key={day.id}
                value={day.id}
                disabled={items.some(
                  (item) =>
                    !days.some(
                      (d) =>
                        d.position ===
                        days.find((d) => d.id === item.dayId)!.position +
                          day.position -
                          source.position,
                    ),
                )}
              >
                {day.title} · {day.date}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label>
          目标层级
          <NativeSelect
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
          >
            <option value="">共同时间线</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {all.find((i) => i.id === b.sectionId)?.title} · {b.title}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <p className="parallel-boundary">
          本次{operation === "copy" ? "复制" : "移动"} {items.length}{" "}
          项，包含组内安排、嵌套分组和公共分开／集合点。各日期之间的间隔保持不变。
        </p>
        <p className="text-xs muted">
          {operation === "copy"
            ? "复制行程安排与路线选择，账单保留在原行程中。"
            : "关联账单随事项调整日期。被其他行动段共用的地点，需先调整关联后再移动。"}
        </p>
        <details className="parallel-batch">
          <summary>查看随段处理的事项</summary>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {days.find((day) => day.id === item.dayId)?.title} ·{" "}
                {item.title}
              </li>
            ))}
          </ul>
        </details>
        <Button type="submit" className="btn primary" disabled={busy}>
          {busy ? "保存中…" : title}
        </Button>
      </form>
    </Modal>
  );
}

function BranchLane({
  days,
  addParallel,
  branch,
  color,
  day,
  dropTarget,
  participants,
  pool,
  editable,
  addItem,
  addPlace,
  children,
}: {
  days: DayPlan[];
  addParallel: () => void;
  branch: PlanBranch;
  color: string;
  day: DayPlan;
  dropTarget?: DropTarget | null;
  participants: Participant[];
  pool: PoolPlace[];
  editable: boolean;
  addItem: (transport?: boolean, dayId?: string) => void;
  addPlace: (placeId: string, dayId?: string) => Promise<unknown>;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `branch:${day.id}:${branch.id}`,
    data: { kind: "branch", dayId: day.id, branchId: branch.id },
  });
  const [targetDayId, setTargetDayId] = useState(day.id);
  const [placeId, setPlaceId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details
      ref={setNodeRef}
      data-branch-id={branch.id}
      data-branch-day={day.id}
      open
      className={`parallel-lane ${isOver ? "drop-over" : ""}`}
      style={{ "--branch-color": color } as CSSProperties}
    >
      <summary>
        <strong>{branch.title}</strong>
        <span>
          {branch.participantIds
            .map(
              (id) => participants.find((p) => p.id === id)?.name ?? "同行者",
            )
            .join("、")}
        </span>
      </summary>
      <div className="parallel-lane-content">
        {children}
        <div
          data-branch-end={branch.id}
          className={`branch-drop-end ${dropTarget?.dayId === day.id && dropTarget.branchId === branch.id && !dropTarget.beforeItemId ? "drop-indicator" : ""}`}
        />
        {editable && (
          <div className="parallel-add">
            <NativeSelect
              aria-label={`${branch.title}添加日期`}
              value={targetDayId}
              onChange={(e) => setTargetDayId(e.target.value)}
            >
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  添加到 {d.title} · {d.date}
                </option>
              ))}
            </NativeSelect>
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addItem(false, targetDayId)}
              >
                添加事项
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addItem(true, targetDayId)}
              >
                添加交通
              </Button>
              <Button size="sm" variant="ghost" onClick={addParallel}>
                组内再分开
              </Button>
            </div>
            {pool.length > 0 && (
              <div className="parallel-pool">
                <NativeSelect
                  aria-label={`向${branch.title}添加收藏地点`}
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                >
                  <option value="">从地点池选择</option>
                  {pool.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  disabled={!placeId || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await addPlace(placeId, targetDayId);
                      setPlaceId("");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  加入
                </Button>
              </div>
            )}
            <ErrorText error={error} />
          </div>
        )}
      </div>
    </details>
  );
}

export function ParallelBlock({
  days,
  addParallel,
  transfer,
  item,
  day,
  dropTarget,
  participants,
  pool,
  participantId,
  editable,
  edit,
  remove,
  addItem,
  addPlace,
  renderItem,
  renderJoinLeg,
}: {
  days: DayPlan[];
  addParallel: (branchId: string) => void;
  transfer: (operation: "copy" | "move") => void;
  item: Item;
  day: DayPlan;
  dropTarget?: DropTarget | null;
  participants: Participant[];
  pool: PoolPlace[];
  participantId: string | null;
  editable: boolean;
  edit: () => void;
  remove: () => void;
  addItem: (branchId: string, transport?: boolean, dayId?: string) => void;
  addPlace: (
    branchId: string,
    placeId: string,
    dayId?: string,
  ) => Promise<unknown>;
  renderItem: (item: Item) => ReactNode;
  renderJoinLeg: (
    branchId: string,
    join: Item,
    role?: "main" | "catch_up",
  ) => ReactNode;
}) {
  const plan = item.parallelPlan!;
  const all = planningItems(day);
  const split = all.find((i) => i.id === plan.splitItemId),
    join = all.find((i) => i.id === plan.joinItemId);
  const parent = all
    .flatMap((i) => i.parallelPlan?.branches ?? [])
    .find((b) => b.id === item.branchId);
  const unassigned = participants.filter(
    (p) =>
      p.status === "active" &&
      (!parent || parent.participantIds.includes(p.id)) &&
      !plan.branches.some((b) => b.participantIds.includes(p.id)),
  );
  const branches = plan.branches.filter(
    (b) => !participantId || b.participantIds.includes(participantId),
  );
  return (
    <section
      className={`parallel-block ${dropTarget?.dayId === day.id && dropTarget.beforeItemId === item.id ? "drop-before" : ""}`}
      id={
        item.dayId === day.id
          ? `item-${item.id}`
          : `item-${item.id}-continue-${day.id}`
      }
      aria-label={item.title}
    >
      <header>
        <GitFork size={18} />
        <strong>
          {item.dayId !== day.id ? "续：" : ""}
          {item.title}
        </strong>
        {editable && (
          <div>
            <button onClick={edit}>设置</button>
            <button onClick={() => transfer("copy")}>复制整段</button>
            <button onClick={() => transfer("move")}>移动整段</button>
            <button onClick={remove}>删除</button>
          </div>
        )}
      </header>
      <p className="parallel-boundary">
        {split ? `默认从「${split.title}」分开` : "各自出发"}
        {join ? ` · 在「${join.title}」集合` : " · 各自结束"}
      </p>
      {!branches.length && (
        <p className="parallel-unassigned">该同行者在这段行动中暂未分组。</p>
      )}
      <div className="parallel-lanes">
        {branches.map((branch) => {
          const destination = all.find(
            (i) =>
              i.id ===
              (branch.joinItemId === undefined
                ? plan.joinItemId
                : branch.joinItemId),
          );
          const catchUp = all.find((i) => i.id === branch.catchUpItemId);
          const children = displayItems(day).filter(
            (i) => i.branchId === branch.id,
          );
          const independent = branch.departureItemId !== undefined || !split;
          const origin = independent
            ? (all.find((i) => i.id === branch.departureItemId) ??
              days
                .flatMap((d) => d.items)
                .find(
                  (i) =>
                    i.branchId === branch.id &&
                    i.type !== "note" &&
                    i.type !== "parallel",
                ))
            : split;
          const ownerDay = days.find((d) => d.id === item.dayId) ?? day;
          const originDate =
            days.find((d) => d.id === origin?.dayId) ?? ownerDay;
          const originTime =
            branch.startMinutes == null
              ? (origin?.startMinutes ?? originDate.startMinutes)
              : branch.startMinutes -
                (originDate.position - ownerDay.position) * 1440;
          const joiningHere = branch.entrants?.find(
            (entrant) =>
              entrant.participantId === participantId &&
              entrant.at === "meeting",
          );
          return (
            <BranchLane
              key={branch.id}
              days={days.filter(
                (d) =>
                  d.position >=
                  (days.find((d) => d.id === item.dayId)?.position ?? 0),
              )}
              addParallel={() => addParallel(branch.id)}
              branch={branch}
              day={day}
              dropTarget={dropTarget}
              color={
                branchColors[plan.branches.findIndex((b) => b.id === branch.id)]
              }
              participants={participants}
              pool={pool}
              editable={editable}
              addItem={(transport, targetDayId) =>
                addItem(branch.id, transport, targetDayId)
              }
              addPlace={(placeId, targetDayId) =>
                addPlace(branch.id, placeId, targetDayId)
              }
            >
              <p className="parallel-departure">
                {joiningHere
                  ? `直接在「${destination?.title ?? "集合点"}」加入，不参与此前安排`
                  : `${originDate.title} ${formatTime(originTime * 60)} · ${origin ? `从「${origin.title}」出发` : "出发地点待补充"}`}
              </p>
              {!participantId &&
                branch.entrants?.map((entrant) => (
                  <p
                    className="parallel-entry-note"
                    key={entrant.participantId}
                  >
                    {participants.find(
                      (person) => person.id === entrant.participantId,
                    )?.name ?? "同行者"}
                    ：
                    {entrant.at === "meeting"
                      ? `在「${destination?.title ?? "集合点"}」加入`
                      : "从本组出发地加入"}
                  </p>
                ))}
              {children.map(renderItem)}
              {!children.length && (
                <p className="parallel-empty">
                  {item.dayId !== day.id
                    ? "跨日行动继续"
                    : split && destination
                      ? "直接前往集合点"
                      : "添加本组的出发地或安排"}
                </p>
              )}
              {destination && (
                <div className="parallel-join-leg">
                  {renderJoinLeg(branch.id, destination)}
                  <span>
                    <MapPin size={12} />
                    前往 {
                      days.find((d) => d.id === destination.dayId)?.title
                    } · {destination.title}
                  </span>
                </div>
              )}
              {catchUp && (
                <div className="parallel-join-leg">
                  <span>
                    迟到时改赴 {days.find((d) => d.id === catchUp.dayId)?.title}{" "}
                    · {catchUp.title}
                  </span>
                  {renderJoinLeg(branch.id, catchUp, "catch_up")}
                </div>
              )}
            </BranchLane>
          );
        })}
      </div>
      {!participantId && unassigned.length > 0 && (
        <p className="parallel-unassigned">
          本段暂未安排：{unassigned.map((p) => p.name).join("、")}
        </p>
      )}
    </section>
  );
}

export function Rendezvous({
  entry,
  participants = [],
}: {
  entry: TimelineEntry;
  participants?: Participant[];
}) {
  if (!entry.rendezvous) {
    if (
      entry.personal ||
      !entry.people ||
      new Set(entry.people.map((person) => person.start)).size < 2
    )
      return null;
    return (
      <div className="rendezvous">
        <strong>各人预计时间</strong>
        <ul>
          {entry.people.map((person) => (
            <li key={person.participantId}>
              <span>
                {participants.find((p) => p.id === person.participantId)
                  ?.name ?? "同行者"}
              </span>
              <span>
                {person.skipped ? "已改赴后续会合点" : formatTime(person.start)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="rendezvous">
      <strong>
        <Users size={14} />
        集合 ·{" "}
        {entry.rendezvous.policy === "wait_all" ? "等齐再走" : "按固定时间开始"}
      </strong>
      <ul>
        {entry.rendezvous.arrivals.map((group) => (
          <li key={group.branchId}>
            <span>{group.title}</span>
            <span>
              {group.catchUpTitle
                ? `改赴「${group.catchUpTitle}」会合`
                : group.arrival === null
                  ? "到达时间待定"
                  : `预计 ${formatTime(group.arrival)} 到达`}
              {group.waitMinutes ? `，等待 ${group.waitMinutes} 分钟` : ""}
              {group.lateMinutes ? `，迟到 ${group.lateMinutes} 分钟` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
