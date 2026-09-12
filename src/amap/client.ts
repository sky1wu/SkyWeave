import type { z } from "zod";
import type { Config } from "./config";
import { ApiError, upstreamError } from "./errors";
import { envelopeSchema, geocodeSchema, poisSchema, tipsSchema } from "./types";
import { routeEnvelopeSchema } from "./mapper";
import type { RouteProfile } from "./requests";

export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;
type Endpoint =
  | "/v5/place/text"
  | "/v5/place/detail"
  | "/v3/assistant/inputtips"
  | "/v3/geocode/regeo"
  | "/v5/direction/driving"
  | "/v5/direction/walking"
  | "/v5/direction/bicycling"
  | "/v5/direction/transit/integrated";

async function readJson(response: Response, limit: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, "AMap response too large");
  }
  if (!response.body) throw new ApiError(502, "Empty AMap response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError(502, "AMap response too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(502, "Invalid AMap JSON response");
  }
}

export class AmapClient {
  private active = 0;
  private queued = 0;
  private nextStart = new Map<string, number>();
  constructor(
    private readonly config: Config,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private async request<T>(
    path: Endpoint,
    parameters: Record<string, string>,
    schema: z.ZodType<T>,
    timeoutMs = this.config.AMAP_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const interval = this.config.AMAP_MIN_INTERVAL_MS ?? 0;
      if (interval > 0) {
        if (this.queued >= 16) throw new ApiError(503, "Request queue is full");
        const start = Math.max(
          performance.now(),
          this.nextStart.get(path) ?? 0,
        );
        this.nextStart.set(path, start + interval);
        this.queued++;
        try {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              signal?.removeEventListener("abort", abort);
              reject(new ApiError(504, "AMap upstream timeout"));
            };
            const timer = setTimeout(
              () => {
                signal?.removeEventListener("abort", abort);
                resolve();
              },
              Math.max(0, start - performance.now()),
            );
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          });
        } finally {
          this.queued--;
        }
      }
      try {
        return await this.requestAttempt(
          path,
          parameters,
          schema,
          timeoutMs,
          signal,
        );
      } catch (error) {
        if (
          attempt === 0 &&
          interval > 0 &&
          error instanceof ApiError &&
          ["10004", "10014", "10021"].includes(error.infocode ?? "")
        )
          continue;
        throw error;
      }
    }
  }

  private async requestAttempt<T>(
    path: Endpoint,
    parameters: Record<string, string>,
    schema: z.ZodType<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.config.AMAP_KEY)
      throw new ApiError(503, "AMap key is not configured");
    if (signal?.aborted) throw new ApiError(504, "AMap upstream timeout");
    if (this.active >= this.config.AMAP_MAX_CONCURRENT)
      throw new ApiError(503, "Adapter upstream concurrency limit reached");
    this.active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const url = new URL(path, "https://restapi.amap.com");
    // Caller headers/keys/URLs cannot reach this request.
    url.search = new URLSearchParams({
      ...parameters,
      key: this.config.AMAP_KEY,
      output: "json",
    }).toString();
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        signal: combinedSignal,
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      // Parse error envelopes as well, to preserve AMap infocode even on non-2xx HTTP.
      let raw: unknown;
      try {
        raw = await readJson(response, this.config.AMAP_MAX_RESPONSE_BYTES);
      } catch (error) {
        if (!response.ok && !combinedSignal.aborted) {
          throw new ApiError(
            response.status === 429 ? 429 : response.status === 504 ? 504 : 502,
            "AMap HTTP upstream error",
          );
        }
        throw error;
      }
      const envelope = envelopeSchema.safeParse(raw);
      if (
        envelope.success &&
        (envelope.data.status !== "1" ||
          (envelope.data.infocode && envelope.data.infocode !== "10000"))
      ) {
        throw upstreamError(envelope.data.infocode ?? "00000");
      }
      if (!response.ok)
        throw new ApiError(
          response.status === 429 ? 429 : response.status === 504 ? 504 : 502,
          "AMap HTTP upstream error",
        );
      if (!envelope.success)
        throw new ApiError(502, "Invalid AMap response envelope");
      const data = schema.safeParse(raw);
      if (!data.success) throw new ApiError(502, "Invalid AMap response data");
      return data.data;
    } catch (error) {
      if (combinedSignal.aborted)
        throw new ApiError(504, "AMap upstream timeout");
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "AMap upstream network error");
    } finally {
      clearTimeout(timer);
      this.active--;
    }
  }

  search(parameters: Record<string, string>) {
    return this.request("/v5/place/text", parameters, poisSchema);
  }
  details(parameters: Record<string, string>) {
    return this.request("/v5/place/detail", parameters, poisSchema);
  }
  autocomplete(parameters: Record<string, string>) {
    return this.request("/v3/assistant/inputtips", parameters, tipsSchema);
  }
  directions(
    profile: RouteProfile,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ) {
    const paths = {
      driving: "/v5/direction/driving",
      walking: "/v5/direction/walking",
      cycling: "/v5/direction/bicycling",
      transit: "/v5/direction/transit/integrated",
    } as const;
    return this.request(
      paths[profile],
      parameters,
      routeEnvelopeSchema,
      this.config.AMAP_TIMEOUT_MS,
      signal,
    );
  }
  region(location: string, signal?: AbortSignal) {
    return this.request(
      "/v3/geocode/regeo",
      { location, extensions: "base" },
      geocodeSchema,
      Math.min(this.config.AMAP_TIMEOUT_MS, 1500),
      signal,
    );
  }
}
