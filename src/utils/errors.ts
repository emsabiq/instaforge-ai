import axios from "axios";

export function describeHttpError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const data = error.response?.data;
  const detail =
    typeof data === "string"
      ? data
      : data && typeof data === "object"
        ? JSON.stringify(data)
        : undefined;

  return [
    error.message,
    status ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}` : "",
    detail ? `Response: ${detail.slice(0, 500)}` : ""
  ]
    .filter(Boolean)
    .join(" | ");
}
