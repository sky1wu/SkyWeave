"use client";

import { useState } from "react";
import { Users, ChevronRight } from "lucide-react";
import type { PlanBranch } from "@/domain/parallel";
import { Button } from "./ui/button";
import { Modal, ErrorText } from "./ui";
import type { Item, Participant } from "@/domain/types";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

export function ItemParticipants({
  participants,
  value,
  onChange,
  automaticParticipantIds,
  inBranch = false,
  hideLegend = false,
}: {
  participants: Participant[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  automaticParticipantIds?: string[];
  inBranch?: boolean;
  hideLegend?: boolean;
}) {
  const available = participants.filter(
    (person) => person.status === "active" || value?.includes(person.id),
  );
  return (
    <fieldset className="item-participants-field grid gap-3">
      <legend className={hideLegend ? "sr-only" : "mb-3 text-sm font-medium"}>
        谁参加
      </legend>
      <Label>
        参加人员
        <NativeSelect
          aria-label="参加人员"
          value={value === null ? "all" : "selected"}
          onChange={(event) =>
            onChange(event.target.value === "all" ? null : [])
          }
        >
          <option value="all">
            {inBranch ? "自动跟随本组安排" : "自动跟随行程安排"}
          </option>
          <option value="selected">
            {inBranch ? "本组部分成员" : "指定人员"}
          </option>
        </NativeSelect>
      </Label>
      {value === null && (
        <p className="text-xs muted">
          {automaticParticipantIds !== undefined
            ? `实际参加：${automaticParticipantIds.length ? automaticParticipantIds.map((id) => participants.find((p) => p.id === id)?.name ?? "同行者").join("、") : "暂无参与者"}。`
            : "自动按成员加入时间和所属路线确定参加人员。"}
        </p>
      )}
      {value !== null && (
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          {available.map((person) => (
            <Label key={person.id} className="flex items-center gap-2">
              <Checkbox
                checked={value.includes(person.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...value, person.id]
                      : value.filter((id) => id !== person.id),
                  )
                }
              />
              {person.name}
              {person.status === "inactive" ? "（已停用）" : ""}
            </Label>
          ))}
          {!available.length && (
            <p className="text-xs muted">请先在成员页添加同行者。</p>
          )}
        </div>
      )}
      <p className="text-xs muted">
        实际参加人员还会按加入时间和路线确定；设置只作用于这条安排，费用分摊保持原样。
      </p>
    </fieldset>
  );
}

export function ItemParticipantSummary({
  item,
  attendingParticipantIds,
  participants,
  branch,
  edit,
}: {
  item: Item;
  participants: Participant[];
  branch?: Pick<PlanBranch, "title" | "participantIds">;
  attendingParticipantIds?: string[];
  edit?: () => void;
}) {
  const configured =
    item.participantIds ??
    branch?.participantIds ??
    participants.filter((p) => p.status === "active").map((p) => p.id);
  const actual = attendingParticipantIds ?? configured;
  const restricted =
    configured.length !== actual.length ||
    configured.some((id) => !actual.includes(id));
  const names = actual
    .map((id) => participants.find((p) => p.id === id)?.name ?? "同行者")
    .join("、");
  const summary = !actual.length
    ? "暂无参与者"
    : item.participantIds || restricted
      ? names
      : branch
        ? "本组全部成员"
        : "全部同行者";
  const inheritance = restricted
    ? "按加入时间与路线计算"
    : branch
      ? item.participantIds
        ? branch.participantIds.some((id) => !item.participantIds!.includes(id))
          ? "本组部分成员"
          : "本组指定成员"
        : `跟随「${branch.title}」`
      : null;
  const content = (
    <>
      <Users size={14} aria-hidden="true" />
      <span className="item-participant-label">谁参加</span>
      <span className="item-participant-value">
        {summary}
        {inheritance && <small>{inheritance}</small>}
      </span>
      {edit && <ChevronRight size={14} aria-hidden="true" />}
    </>
  );
  return edit ? (
    <button
      type="button"
      className="item-participant-summary"
      onClick={edit}
      aria-label={`${item.title}：谁参加，${summary}${inheritance ? `，${inheritance}` : ""}`}
      aria-haspopup="dialog"
      title={names}
    >
      {content}
    </button>
  ) : (
    <div className="item-participant-summary" title={names}>
      {content}
    </div>
  );
}

export function ItemParticipantsEditor({
  item,
  automaticParticipantIds,
  participants,
  branch,
  close,
  save,
}: {
  item: Item;
  participants: Participant[];
  branch?: Pick<PlanBranch, "title" | "participantIds">;
  automaticParticipantIds?: string[];
  close: () => void;
  save: (data: {
    participantIds: string[] | null;
    expectedVersion: number;
  }) => Promise<unknown>;
}) {
  const [value, setValue] = useState(item.participantIds ?? null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="谁参加" close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError("");
          if (value?.length === 0) {
            setError("请至少选择一位参与者");
            return;
          }
          setBusy(true);
          try {
            await save({
              participantIds: value,
              expectedVersion: item.version,
            });
            close();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="item-participant-subject">{item.title}</p>
        {branch && (
          <p className="text-sm muted">
            所属路线：{branch.title}。默认跟随本组成员，也可只选择本组部分成员。
          </p>
        )}
        <fieldset disabled={busy}>
          <ItemParticipants
            automaticParticipantIds={automaticParticipantIds}
            participants={participants.filter(
              (person) => !branch || branch.participantIds.includes(person.id),
            )}
            value={value}
            inBranch={!!branch}
            hideLegend
            onChange={(value) => {
              setValue(value);
              setError("");
            }}
          />
        </fieldset>
        <ErrorText error={error} />
        <div className="actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "保存中…" : "保存参与者"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
