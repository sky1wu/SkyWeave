"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { TripSnapshot } from "@/domain/types";
import type { Mutate } from "./planner";
import { ErrorText, Modal } from "./ui";
export interface CommentTarget {
  type: "trip" | "day_item" | "expense";
  id: string;
  title: string;
}
export function Comments({
  snapshot,
  target,
  mutate,
}: {
  snapshot: TripSnapshot;
  target: CommentTarget;
  mutate: Mutate;
}) {
  const [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const comments = snapshot.comments.filter(
    (c) => c.targetType === target.type && c.targetId === target.id,
  );
  return (
    <div>
      <div className="comment-list">
        {comments.length ? (
          comments.map((c) => (
            <div className="comment-row" key={c.id}>
              <div className="avatar">{c.authorName.slice(0, 1)}</div>
              <div>
                <div className="text-xs">
                  <b>{c.authorName}</b>
                  <span className="muted ml-3">
                    {DateTime.fromMillis(c.createdAt)
                      .setZone(snapshot.trip.timezone)
                      .toFormat("MM-dd HH:mm")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap mt-2 break-words">
                  {c.content}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="muted text-sm py-5">这里还没有评论，聊聊你的想法吧。</p>
        )}
      </div>
      <form
        className="grid gap-3 mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await mutate(`/trips/${snapshot.trip.id}/comments`, "POST", {
              targetType: target.type,
              targetId: target.id,
              content,
            });
            setContent("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorText error={error} />
        <textarea
          aria-label="评论内容"
          placeholder="分享安排、提醒或集合地点…"
          rows={3}
          required
          maxLength={4000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="btn primary justify-self-end"
          disabled={busy || !content.trim()}
        >
          发表评论
        </button>
      </form>
    </div>
  );
}
export function CommentModal({
  snapshot,
  target,
  mutate,
  close,
}: {
  snapshot: TripSnapshot;
  target: CommentTarget;
  mutate: Mutate;
  close: () => void;
}) {
  return (
    <Modal title={`讨论 · ${target.title}`} close={close}>
      <Comments snapshot={snapshot} target={target} mutate={mutate} />
    </Modal>
  );
}
export function ActivityPage({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
}) {
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP EVERYONE IN THE LOOP</span>
          <h2 className="section-title mt-2">旅程里的新鲜事</h2>
        </div>
        <span className="pill">协作动态</span>
      </div>
      <div className="activity-grid">
        <section className="panel p-6">
          <h3 className="font-semibold mb-5">最近动态</h3>
          {snapshot.activity.map((a) => (
            <div className="activity-row" key={a.id}>
              <div className="activity-dot" />
              <div className="flex-1">
                <p className="text-sm">
                  <b>{a.actorName}</b> {a.summary}
                </p>
                <p className="text-xs muted mt-2">
                  {DateTime.fromMillis(a.createdAt)
                    .setZone(snapshot.trip.timezone)
                    .toFormat("MM-dd HH:mm")}
                </p>
              </div>
            </div>
          ))}
        </section>
        <section className="panel p-6 self-start">
          <h3 className="font-semibold mb-3">一起聊聊这次旅行</h3>
          <Comments
            snapshot={snapshot}
            target={{
              type: "trip",
              id: snapshot.trip.id,
              title: snapshot.trip.title,
            }}
            mutate={mutate}
          />
        </section>
      </div>
    </main>
  );
}
