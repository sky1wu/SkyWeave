import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AppError } from "@/server/errors";
import { authenticateMcp } from "@/server/mcp-tokens";
import { createMcpServer } from "@/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(415, "CONTENT_TYPE", "请求必须使用 JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_JSON", "请求内容为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 524288) {
        await reader.cancel();
        throw new AppError(413, "BODY_TOO_LARGE", "请求内容过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "INVALID_JSON", "JSON 格式无效");
  }
}

async function handler(request: Request): Promise<Response> {
  try {
    // Use the configured public origin, never a caller-controlled Host header.
    const origin = request.headers.get("origin");
    if (
      origin &&
      origin !==
        new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin
    )
      throw new AppError(403, "ORIGIN", "请求来源无效");
    const principal = authenticateMcp(request);
    // No persistent sessions or server-initiated SSE streams in this endpoint.
    if (request.method !== "POST")
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "仅支持 POST" },
        },
        {
          status: 405,
          headers: { Allow: "POST", "Cache-Control": "no-store" },
        },
      );
    const parsedBody = await readBody(request);
    const server = createMcpServer(principal);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    if (status === 500)
      console.error({
        endpoint: "mcp",
        error: error instanceof Error ? error.name : "UnknownError",
      });
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: status === 400 ? -32700 : -32000,
          message:
            error instanceof AppError
              ? error.message
              : "服务暂时不可用，请稍后重试",
        },
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 401
            ? { "WWW-Authenticate": 'Bearer realm="SkyWeave MCP"' }
            : {}),
        },
      },
    );
  }
}

export { handler as POST, handler as GET, handler as DELETE };
