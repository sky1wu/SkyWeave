"use client";

import { useState } from "react";
import type { ParticipantAlias } from "@/domain/types";
import { ApiFailure } from "@/lib/client";
import { ErrorText, Modal } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function MemberAliasEditor({
  originalName,
  alias,
  save,
  refresh,
  close,
}: {
  originalName: string;
  alias: ParticipantAlias;
  save: (participantId: string, name: string, version: number) => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [name, setName] = useState(alias.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  return (
    <Modal
      title="设置备注名"
      close={() => {
        if (!pending) close();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || stale) return;
          setPending(true);
          setError("");
          try {
            await save(alias.participantId, name, alias.version);
            close();
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 409) {
              setStale(true);
              setError("你在其他页面修改了此备注名，请关闭后重新打开再编辑。");
              void refresh();
            } else
              setError(
                error instanceof Error
                  ? error.message
                  : "备注名未保存，请重试。",
              );
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="text-sm muted break-words">原姓名：{originalName}</p>
        <Label>
          备注名
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            disabled={pending || stale}
            placeholder="例如：小林"
            aria-describedby="member-alias-help"
          />
        </Label>
        <p id="member-alias-help" className="text-sm muted">
          仅你可见，用于此行程的成员列表。清空后恢复显示原姓名。
        </p>
        <ErrorText error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={close}
          >
            取消
          </Button>
          <Button
            type="submit"
            disabled={pending || stale || name.trim() === alias.name}
          >
            {pending ? "保存中…" : "保存备注名"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
