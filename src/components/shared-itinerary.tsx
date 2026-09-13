"use client";

import { useEffect, useState } from "react";
import { Link2Off } from "lucide-react";
import type { ItineraryDocument } from "@/domain/itinerary";
import { ItineraryContent } from "./itinerary-view";
import { Brand } from "./ui";
import { Button } from "./ui/button";

export function SharedItinerary({ token }: { token: string }) {
  const [itinerary, setItinerary] = useState<ItineraryDocument | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(
          `/api/share/${encodeURIComponent(token)}`,
          {
            cache: "no-store",
            signal: current.signal,
          },
        );
        const result = await response.json();
        if (cancelled || current.signal.aborted) return;
        if (!response.ok) {
          setItinerary(null);
          setUnavailable(response.status === 404);
          setError(result.error?.message ?? "暂时无法加载行程，请稍后重试");
          if (response.status === 404) return;
        } else {
          setItinerary(result as ItineraryDocument);
          setUnavailable(false);
          setError("");
        }
      } catch {
        if (cancelled || current.signal.aborted) return;
        setItinerary(null);
        setError("暂时无法加载行程，请检查网络后重试");
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 15_000);
    }
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, attempt]);

  return (
    <>
      <header className="site-header">
        <Brand />
        <span className="itinerary-public-label">公开行程 · 只读</span>
      </header>
      {itinerary ? (
        <ItineraryContent itinerary={itinerary} />
      ) : (
        <main className="itinerary-view">
          <div className="itinerary-empty">
            {error ? (
              <>
                <Link2Off size={28} />
                <h1>{unavailable ? "分享链接已失效" : "行程加载失败"}</h1>
                <p role="alert">{error}</p>
                {unavailable ? (
                  <p>请联系分享者获取新的链接。</p>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setAttempt((n) => n + 1);
                    }}
                  >
                    重试
                  </Button>
                )}
              </>
            ) : (
              <p role="status">正在加载行程…</p>
            )}
          </div>
        </main>
      )}
    </>
  );
}
