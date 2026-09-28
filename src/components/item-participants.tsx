"use client";

import type { Participant } from "@/domain/types";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

export function ItemParticipants({
  participants,
  value,
  onChange,
  inBranch = false,
}: {
  participants: Participant[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  inBranch?: boolean;
}) {
  const available = participants.filter(
    (person) => person.status === "active" || value?.includes(person.id),
  );
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">参与者</legend>
      <Label>
        参与范围
        <NativeSelect
          aria-label="参与范围"
          value={value === null ? "all" : "selected"}
          onChange={(event) =>
            onChange(event.target.value === "all" ? null : [])
          }
        >
          <option value="all">
            {inBranch ? "本组全部成员" : "全部同行者"}
          </option>
          <option value="selected">指定参与者</option>
        </NativeSelect>
      </Label>
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
        仅所选人员参加这条安排；其他人的行程和已有费用分摊保持原样。
      </p>
    </fieldset>
  );
}
