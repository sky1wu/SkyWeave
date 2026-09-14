import { z } from "zod";
import { AppError } from "@/server/errors";
import { actor, body, sameOrigin } from "@/server/http";
import {
  UNHANDLED,
  type ApiDispatcher,
  type ApiRequestContext,
} from "@/server/api/dispatcher";
import { dispatchCollaboration } from "@/server/api/collaboration-dispatcher";
import { dispatchFinance } from "@/server/api/finance-dispatcher";
import { dispatchPlanning } from "@/server/api/planning-dispatcher";
import { dispatchPlatform } from "@/server/api/platform-dispatcher";
import { dispatchTrip } from "@/server/api/trip-dispatcher";
import {
  MAX_TRIP_FILE_BYTES,
  TRIP_FILE_SIZE_MESSAGE,
} from "@/domain/trip-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

const dispatchers: ApiDispatcher[] = [
  dispatchPlatform,
  dispatchTrip,
  dispatchPlanning,
  dispatchCollaboration,
  dispatchFinance,
];

async function dispatch(context: ApiRequestContext) {
  for (const dispatcher of dispatchers) {
    const result = await dispatcher(context);
    if (result !== UNHANDLED) return result;
  }
  throw new AppError(404, "NOT_FOUND", "接口不存在");
}

async function handler(request: Request, context: Context): Promise<Response> {
  const started = performance.now();
  const requestId = crypto.randomUUID();
  let status = 200;
  let endpoint = "unknown";
  try {
    const { path } = await context.params;
    endpoint = path[0];
    const [root, id, action, subId] = path;
    const method = request.method;
    if (root === "health" && method === "GET")
      return Response.json({ ok: true });

    const user = await actor(request);
    if (method !== "GET") sameOrigin(request);
    const importing =
      method === "POST" &&
      root === "trips" &&
      id === "import" &&
      path.length === 2;
    const data =
      method === "GET"
        ? undefined
        : await body(
            request,
            importing ? MAX_TRIP_FILE_BYTES : undefined,
            importing ? TRIP_FILE_SIZE_MESSAGE : undefined,
          );
    const result = await dispatch({
      request,
      path,
      root,
      id,
      action,
      subId,
      method,
      url: new URL(request.url),
      user,
      data,
    });
    if (result instanceof Response) {
      status = result.status;
      return result;
    }
    const response = Response.json(result, {
      headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" },
    });
    response.headers.set(
      "Server-Timing",
      `app;dur=${(performance.now() - started).toFixed(1)}`,
    );
    return response;
  } catch (error) {
    status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}：${issue.message}`)
              .join("；")
          : "服务暂时不可用，请稍后重试";
    if (status === 500)
      console.error({
        requestId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    return Response.json(
      {
        error: {
          code:
            error instanceof AppError
              ? error.code
              : status === 400
                ? "VALIDATION"
                : "INTERNAL",
          message,
        },
        requestId,
      },
      { status },
    );
  } finally {
    console.info(
      JSON.stringify({
        requestId,
        endpoint,
        operation: request.method,
        duration: Math.round(performance.now() - started),
        status,
      }),
    );
  }
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
