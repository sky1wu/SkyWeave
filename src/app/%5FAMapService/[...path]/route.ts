import { actor } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    await actor(request);
    const { path } = await params,
      route = path.join("/");
    if (!/^(?:v3|v4|v5)\/[a-zA-Z0-9_/-]+$/.test(route) || route.includes(".."))
      return new Response("Not found", { status: 404 });
    if (!process.env.AMAP_JS_KEY || !process.env.AMAP_SECURITY_CODE)
      return new Response("Map configuration unavailable", { status: 503 });
    const url = new URL(
      `/${route}`,
      route.startsWith("v4/map/styles")
        ? "https://webapi.amap.com"
        : "https://restapi.amap.com",
    );
    url.search = new URL(request.url).search;
    url.searchParams.set("key", process.env.AMAP_JS_KEY);
    url.searchParams.set("jscode", process.env.AMAP_SECURITY_CODE);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new Response("Map service unavailable", { status: 502 });
  }
}
