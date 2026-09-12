export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  message = "内容不存在",
): T {
  if (value == null) throw new AppError(404, "NOT_FOUND", message);
  return value;
}
export function conflict() {
  throw new AppError(409, "CONFLICT", "此内容已被其他成员修改，请刷新后重试");
}
