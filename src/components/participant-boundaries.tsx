"use client";

import { useMemo, useState } from "react";
import { compilePlan } from "@/domain/plan-graph";
import type { DayPlan, Item, Participant } from "@/domain/types";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { ErrorText } from "./ui";

export type ParticipationChange = {
  participantId: string;
  joinItemId?: string | null;
  leaveItemId?: string | null;
};

export function ParticipantBoundaries({
  item,
  days,
  participants,
  disabled,
  save,
  close,
  onBusyChange,
}: {
  item: Item;
  days: DayPlan[];
  participants: Participant[];
  disabled: boolean;
  save: (data: ParticipationChange) => Promise<unknown>;
  close: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const graph = useMemo(() => compilePlan(days), [days]);
  const start = graph.admissions.get(personId),
    end = graph.exits.get(personId);
  const label = (id: string, dayId: string) =>
    `${days.find((day) => day.id === dayId)?.title ?? ""} · ${graph.byId.get(id)?.title ?? "未命名安排"}`;
  async function change(data: Omit<ParticipationChange, "participantId">) {
    if (disabled || busy || !personId) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await save({ participantId: personId, ...data });
      close();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <details className="participant-boundaries">
      <summary>设置加入与离开</summary>
      <p className="text-xs muted">
        设置这个人整趟行程的参与范围，加入和离开节点都包含当前安排。新加入点会替换此人原有的加入设置。
      </p>
      <Label>
        给谁设置
        <NativeSelect
          aria-label="给谁设置参与范围"
          value={personId}
          disabled={busy || disabled}
          onChange={(event) => {
            setPersonId(event.target.value);
            setError("");
          }}
        >
          <option value="">选择同行者</option>
          {participants.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {personId && (
        <div className="participation-boundary-current" aria-live="polite">
          <p>加入：{start ? label(start.itemId, start.dayId) : "从行程开始"}</p>
          <p>
            离开：
            {end ? `${label(end.itemId, end.dayId)}结束后` : "参与至行程结束"}
          </p>
        </div>
      )}
      {disabled && (
        <p className="text-xs muted">
          请先保存当前事项的人员选择，再设置加入与离开。
        </p>
      )}
      <ErrorText error={error} />
      <div className="participation-boundary-actions">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || !personId || start?.itemId === item.id}
          onClick={() => void change({ joinItemId: item.id })}
        >
          从此处加入
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || !personId || end?.itemId === item.id}
          onClick={() => void change({ leaveItemId: item.id })}
        >
          此项结束后离开
        </Button>
      </div>
      {personId && (start || end) && (
        <div className="participation-boundary-actions">
          {start && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => void change({ joinItemId: null })}
            >
              清除加入限制
            </Button>
          )}
          {end && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => void change({ leaveItemId: null })}
            >
              清除离开限制
            </Button>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="text-xs muted">
          正在更新参与范围…
        </p>
      )}
    </details>
  );
}
