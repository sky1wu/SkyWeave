"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
} from "lucide-react";
import type { ItineraryDay } from "@/domain/itinerary";
import type { PosterOptions, PosterPage } from "@/lib/itinerary-poster";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { ErrorText, Modal } from "./ui";

type Preview = PosterPage & { url: string };
export function ItineraryExport({
  title,
  dates,
  timezone,
  days,
  close,
}: {
  title: string;
  dates: string;
  timezone: string;
  days: ItineraryDay[];
  close: () => void;
}) {
  const [scope, setScope] = useState("all");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [preview, setPreview] = useState<{
    key: string;
    pages: Preview[];
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const key = JSON.stringify({
    title,
    dates,
    timezone,
    days: scope === "all" ? days : days.filter((day) => day.id === scope),
    includeNotes,
    attempt,
  });
  const pages = preview?.key === key ? preview.pages : [];
  const error = failure?.key === key ? failure.message : "";
  const current = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const busy = !pages.length && !error;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const urls: string[] = [];
    async function generate() {
      try {
        const { renderItineraryPoster } =
          await import("@/lib/itinerary-poster");
        if (cancelled) return;
        const result = await renderItineraryPoster(
          JSON.parse(key) as PosterOptions,
          controller.signal,
        );
        if (cancelled) return;
        const pages = result.map((page) => {
          const url = URL.createObjectURL(page.blob);
          urls.push(url);
          return { ...page, url };
        });
        setPreview({ key, pages });
      } catch (e) {
        if (!cancelled)
          setFailure({
            key,
            message: e instanceof Error ? e.message : "图片生成失败，请重试。",
          });
      }
    }
    void generate();
    return () => {
      cancelled = true;
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [key]);

  async function download(all: boolean) {
    setDownloading(true);
    setDownloadError("");
    try {
      const { itineraryFilename, posterArchive } =
        await import("@/lib/itinerary-poster");
      const day = days.find((day) => day.id === scope);
      const name = itineraryFilename(
        `${title}${day ? `-第${day.number}天` : ""}-行程`,
      );
      const archive = all && pages.length > 1;
      const blob = archive
        ? await posterArchive(pages, name)
        : pages[current].blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = archive
        ? `${name}.zip`
        : `${name}${pages.length > 1 ? `-${current + 1}` : ""}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "下载失败，请重试。");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal title="导出行程图" close={close}>
      <div className="itinerary-export">
        <div className="itinerary-export-options">
          <Label>
            导出范围
            <NativeSelect
              value={scope}
              disabled={downloading}
              onChange={(event) => {
                setScope(event.target.value);
                setPageIndex(0);
              }}
            >
              <option value="all">全部行程（{days.length} 天）</option>
              {days.map((day) => (
                <option key={day.id} value={day.id}>
                  第 {day.number} 天 · {day.date}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="itinerary-notes-toggle flex items-center gap-2">
            <Checkbox
              checked={includeNotes}
              disabled={downloading}
              onCheckedChange={(checked) => {
                setIncludeNotes(checked === true);
                setPageIndex(0);
              }}
            />
            包含描述与备注
          </Label>
        </div>
        <p className="itinerary-export-help">
          高清 PNG 图片，可保存到手机或发给同行的人。长行程会自动分图。
        </p>
        <div
          className="itinerary-export-status"
          role="status"
          aria-live="polite"
        >
          {busy ? (
            <>
              <LoaderCircle size={17} className="itinerary-spinner" />{" "}
              正在生成行程图…
            </>
          ) : pages.length ? (
            `${pages[current].width} × ${pages[current].height} 像素${pages.length > 1 ? `，共 ${pages.length} 张` : ""}`
          ) : (
            ""
          )}
        </div>
        <ErrorText error={error || downloadError} />
        {error && (
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            重新生成
          </Button>
        )}
        {pages.length > 0 && (
          <>
            {pages.length > 1 && (
              <div className="itinerary-export-pager">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="上一张行程图"
                  disabled={current === 0}
                  onClick={() => setPageIndex(current - 1)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <span>
                  第 {current + 1} / {pages.length} 张
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="下一张行程图"
                  disabled={current === pages.length - 1}
                  onClick={() => setPageIndex(current + 1)}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            )}
            <div className="itinerary-export-preview">
              {/* Blob URLs are generated locally and cannot use the Next image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pages[current].url}
                width={pages[current].width}
                height={pages[current].height}
                alt={`${title}行程图，第 ${current + 1} 张`}
              />
            </div>
          </>
        )}
        <div className="itinerary-export-actions">
          {pages.length > 1 && (
            <Button
              variant="outline"
              disabled={busy || downloading}
              onClick={() => void download(false)}
            >
              下载当前图片
            </Button>
          )}
          <Button
            disabled={busy || !!error || downloading}
            onClick={() => void download(true)}
          >
            <Download size={16} />
            {downloading
              ? "准备下载…"
              : pages.length > 1
                ? `下载全部图片（ZIP）`
                : "下载 PNG 图片"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
