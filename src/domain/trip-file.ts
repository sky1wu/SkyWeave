export const TRIP_FILE_FORMAT = "skyweave-trip";
export const TRIP_FILE_VERSION = 1;
export const MAX_TRIP_FILE_BYTES = 20 * 1024 * 1024;
export const TRIP_FILE_SIZE_MESSAGE = "行程文件不能超过 20 MB";

export function tripFilename(title: string) {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${Array.from(name).slice(0, 80).join("") || "行程"}.skyweave.json`;
}
