"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FileUp, LoaderCircle } from "lucide-react";
import { api } from "@/lib/client";
import {
  MAX_TRIP_FILE_BYTES,
  TRIP_FILE_SIZE_MESSAGE,
  tripFilename,
} from "@/domain/trip-file";
import type { TripFile } from "@/server/trip-file-schema";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { ErrorText, Modal } from "./ui";

const fileContents =
  "包含行程日期、每日安排、地点池、交通路线、同行者、费用与结算。";
const collaborationHelp =
  "协作权限、邀请和分享链接、评论与动态不随文件转移；同行者保留为未关联账号的记账参与人。";

export function TripFileExportButton({
  tripId,
  compact = false,
}: {
  tripId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setError("");
    setBusy(true);
    try {
      const file = await api<TripFile>(`/trips/${tripId}/export`);
      const blob = new Blob([JSON.stringify(file, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = tripFilename(file.trip.title);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "文件导出失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "default"}
        aria-label="导出行程文件"
        title="导出行程文件"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <FileDown size={16} />
        {!compact && "导出行程文件"}
      </Button>
      {open && (
        <Modal
          title="导出行程文件"
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm">
              保存为 JSON 文件，可在行程列表中通过「从文件导入」恢复为新行程。
            </p>
            <p className="text-sm muted">{fileContents}</p>
            <p className="text-xs muted">{collaborationHelp}</p>
            <ErrorText error={error} />
            <div className="actions">
              <Button disabled={busy} onClick={() => void download()}>
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <FileDown size={16} />
                )}
                {busy ? "正在导出…" : "下载 JSON 文件"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function TripFileImportButton() {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function importFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > MAX_TRIP_FILE_BYTES)
        throw new Error(TRIP_FILE_SIZE_MESSAGE);
      let data: unknown;
      const content = await file.text();
      try {
        data = JSON.parse(content.replace(/^\uFEFF/, ""));
      } catch {
        throw new Error("文件不是有效的 JSON，请选择 SkyWeave 导出的行程文件");
      }
      const result = await api<{ id: string }>("/trips/import", "POST", data);
      router.push(`/trips/${result.id}/plan`);
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "文件导入失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={() => {
          setFile(null);
          setError("");
          setOpen(true);
        }}
      >
        <FileUp size={18} /> 从文件导入
      </Button>
      {open && (
        <Modal
          title="从文件导入行程"
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form onSubmit={importFile} className="space-y-4">
            <p className="text-sm">
              选择 SkyWeave 导出的 JSON
              文件，创建一个由你管理的新行程。已有行程会保留。
            </p>
            <p className="text-sm muted">{fileContents}</p>
            <p className="text-xs muted">{collaborationHelp}</p>
            <div className="space-y-2">
              <Label htmlFor={inputId}>行程文件</Label>
              <input
                ref={inputRef}
                id={inputId}
                className="sr-only"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  setError(
                    selected && selected.size > MAX_TRIP_FILE_BYTES
                      ? TRIP_FILE_SIZE_MESSAGE
                      : "",
                  );
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <FileUp size={16} />
                {file ? "重新选择文件" : "选择文件"}
              </Button>
            </div>
            {file && (
              <p className="break-all text-sm" role="status">
                已选择：{file.name}
              </p>
            )}
            <p className="text-xs muted">支持 .json 文件，最大 20 MB。</p>
            <ErrorText error={error} />
            <div className="actions">
              <Button
                type="submit"
                disabled={!file || file.size > MAX_TRIP_FILE_BYTES || busy}
              >
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <FileUp size={16} />
                )}
                {busy ? "正在导入…" : "导入为新行程"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
