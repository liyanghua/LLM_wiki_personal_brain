import dayjs from "dayjs";

export function formatDateTime(value?: string): string {
  if (!value) {
    return "unknown";
  }
  return dayjs(value).format("YYYY-MM-DD HH:mm");
}

export function formatScore(value?: number): string {
  if (typeof value !== "number") {
    return "--";
  }
  return value.toFixed(2);
}
