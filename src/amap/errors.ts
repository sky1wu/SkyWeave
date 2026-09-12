import { AppError } from "@/server/errors";
export class ApiError extends AppError {
  constructor(
    status: number,
    message: string,
    public infocode?: string,
  ) {
    super(
      status,
      status === 504
        ? "AMAP_TIMEOUT"
        : status === 429
          ? "AMAP_QUOTA_EXCEEDED"
          : message.includes("key")
            ? "AMAP_INVALID_KEY"
            : "AMAP_UPSTREAM_ERROR",
      status === 504
        ? "高德响应超时，请稍后重试"
        : status === 429
          ? "高德调用配额或频率受限"
          : message.includes("key")
            ? "高德 Key 未配置或权限不可用"
            : "高德服务暂不可用，请重试或改用手动交通段",
    );
  }
}
export function upstreamError(code: string) {
  if (
    [
      "10003",
      "10004",
      "10010",
      "10014",
      "10015",
      "10019",
      "10020",
      "10021",
      "10029",
      "10044",
      "10045",
    ].includes(code)
  )
    return new ApiError(429, "quota", code);
  if (
    [
      "10001",
      "10002",
      "10005",
      "10006",
      "10007",
      "10008",
      "10009",
      "10012",
      "10013",
      "10026",
      "10041",
      "20011",
      "40000",
      "40002",
      "40003",
    ].includes(code)
  )
    return new ApiError(503, "key unavailable", code);
  return new ApiError(502, "upstream error", code);
}
