import type { Actor } from "./service-core";
import { access } from "./service-core";
import { many, one } from "./db";
export function events(
  tripId: string,
  actor: Actor,
  request: Request,
): Response {
  access(tripId, actor);
  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let cursor = one<{ seq: number }>(
        "SELECT coalesce(max(sequence),0) seq FROM activity_logs WHERE tripId=?",
        tripId,
      )!.seq;
      const send = (s: string) => {
        if (!stopped) controller.enqueue(encoder.encode(s));
      };
      send(`event: sync\ndata: {}\n\n`);
      const timer = setInterval(() => {
        try {
          access(tripId, actor);
          if (
            actor.sessionId &&
            !one(
              "SELECT id FROM sessions WHERE id=? AND userId=? AND expiresAt>?",
              actor.sessionId,
              actor.id,
              Date.now(),
            )
          ) {
            close();
            return;
          }
          const rows = many<{
            sequence: number;
            action: string;
            entityId: string;
            actorUserId: string;
          }>(
            "SELECT sequence, action, entityId, actorUserId FROM activity_logs WHERE tripId=? AND sequence>? ORDER BY sequence LIMIT 100",
            tripId,
            cursor,
          );
          for (const r of rows) {
            send(
              `id: ${r.sequence}\nevent: change\ndata: ${JSON.stringify(r)}\n\n`,
            );
            cursor = r.sequence;
          }
        } catch {
          send("event: revoked\ndata: {}\n\n");
          close();
        }
      }, 1000);
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
      close = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* Stream already cancelled. */
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
