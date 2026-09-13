"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import type { ItineraryShare } from "@/domain/itinerary";
import { api } from "@/lib/client";
import { ErrorText, Modal } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ItineraryShareButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Share2 size={16} />
        分享行程
      </Button>
      {open && <ShareDialog tripId={tripId} close={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ tripId, close }: { tripId: string; close: () => void }) {
  const [share, setShare] = useState<ItineraryShare | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const path = `/trips/${tripId}/share`;
  const url = share ? `${window.location.origin}/share/${share.token}` : "";

  useEffect(() => {
    let cancelled = false;
    api<{ share: ItineraryShare | null }>(path)
      .then((result) => {
        if (cancelled) return;
        setShare(result.share);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  async function changeShare() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setCopied(false);
    try {
      if (share) {
        await api(`${path}/${share.id}`, "DELETE", {});
        setShare(null);
        setMessage("已取消分享，原链接已失效。再次创建将生成新链接。");
      } else {
        const result = await api<{ share: ItineraryShare }>(path, "POST", {});
        setShare(result.share);
        setMessage("分享链接已创建，可以复制发送给朋友。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("无法自动复制，请选中上方链接手动复制。");
    }
  }

  return (
    <Modal title="分享行程" close={busy ? () => {} : close}>
      <div className="itinerary-share">
        <p className="itinerary-share-help">
          获得链接的人无需登录即可查看最新行程，包括每日安排、交通、描述和备注。
          成员信息、费用和内部动态不会公开。你可以随时取消分享。
        </p>
        {loaded ? (
          <>
            <p className="itinerary-share-state">
              <Link2 size={16} />
              {share ? "公开分享已开启" : "尚未开启公开分享"}
            </p>
            {share && (
              <>
                <Label htmlFor="itinerary-share-link">公开链接</Label>
                <div className="itinerary-share-link">
                  <Input
                    id="itinerary-share-link"
                    readOnly
                    value={url}
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void copy()}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "已复制" : "复制链接"}
                  </Button>
                </div>
              </>
            )}
            <div className="itinerary-share-actions">
              <Button
                variant={share ? "destructive" : "default"}
                disabled={busy}
                onClick={() => void changeShare()}
              >
                {busy ? "处理中…" : share ? "取消分享" : "创建分享链接"}
              </Button>
            </div>
          </>
        ) : error ? (
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            重试
          </Button>
        ) : (
          <p role="status">正在加载分享状态…</p>
        )}
        <ErrorText error={error} />
        <p className="itinerary-share-help" role="status">
          {copied ? "链接已复制" : message}
        </p>
      </div>
    </Modal>
  );
}
