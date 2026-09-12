import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      // Authentication loss needs a full reload to discard cached private state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(
        `/login?next=${encodeURIComponent(window.location.pathname)}`,
      );
    throw new ApiFailure(
      response.status,
      result.error?.code ?? "ERROR",
      result.error?.message ?? "请求失败，请重试",
    );
  }
  return result as T;
}
