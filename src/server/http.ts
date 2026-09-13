import { auth } from "./auth";
import { AppError } from "./errors";
import type { Actor } from "./service-core";
export async function actor(request: Request): Promise<Actor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new AppError(401, "UNAUTHORIZED", "请先登录");
  return { ...session.user, sessionId: session.session.id };
}
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(415, "CONTENT_TYPE", "请求必须使用 JSON");
  const text = await request.text();
  if (text.length > 524288)
    throw new AppError(413, "BODY_TOO_LARGE", "请求内容过大");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "JSON 格式无效");
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    ![new URL(request.url).origin, process.env.BETTER_AUTH_URL].includes(origin)
  )
    throw new AppError(403, "ORIGIN", "请求来源无效");
}
