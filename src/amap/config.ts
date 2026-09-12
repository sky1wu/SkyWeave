export interface Config {
  AMAP_KEY: string;
  AMAP_TIMEOUT_MS: number;
  AMAP_MAX_CONCURRENT: number;
  AMAP_MAX_RESPONSE_BYTES: number;
  AMAP_MIN_INTERVAL_MS?: number;
}
export function getConfig(): Config {
  return {
    AMAP_KEY: process.env.AMAP_WEB_SERVICE_KEY || "",
    AMAP_TIMEOUT_MS: 8000,
    AMAP_MAX_CONCURRENT: 4,
    AMAP_MAX_RESPONSE_BYTES: 4 * 1024 * 1024,
    AMAP_MIN_INTERVAL_MS: 1100,
  };
}
