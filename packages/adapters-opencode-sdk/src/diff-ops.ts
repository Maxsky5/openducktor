import type { FileDiff, FileStatus } from "@openducktor/contracts";

/**
 * Loads session diffs from the OpenCode SDK API.
 * Endpoint: GET /session/:id/diff?messageID=...
 *
 * Falls back gracefully — returns empty array if the endpoint is unavailable
 * (older OpenCode versions may not expose this route).
 */
export const loadSessionDiff = async (
  baseUrl: string,
  sessionId: string,
  messageId?: string,
): Promise<FileDiff[]> => {
  const url = new URL(`/api/session/${sessionId}/diff`, normalizeBaseUrl(baseUrl));
  if (messageId) {
    url.searchParams.set("messageID", messageId);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();
    return parseFileDiffArray(body);
  } catch {
    return [];
  }
};

/**
 * Loads file status from the OpenCode SDK API.
 * Endpoint: GET /file/status
 */
export const loadFileStatus = async (baseUrl: string): Promise<FileStatus[]> => {
  const url = new URL("/api/file/status", normalizeBaseUrl(baseUrl));

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();
    return parseFileStatusArray(body);
  } catch {
    return [];
  }
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function parseFileDiffArray(body: unknown): FileDiff[] {
  if (!Array.isArray(body)) {
    const wrapped = body as { data?: unknown };
    if (wrapped.data && Array.isArray(wrapped.data)) {
      return (wrapped.data as unknown[]).filter(isFileDiffLike).map(toFileDiff);
    }
    return [];
  }
  return (body as unknown[]).filter(isFileDiffLike).map(toFileDiff);
}

function isFileDiffLike(item: unknown): item is Record<string, unknown> {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return typeof record.file === "string";
}

function toFileDiff(item: Record<string, unknown>): FileDiff {
  return {
    file: String(item.file ?? ""),
    type: normalizeType(item.type),
    additions: typeof item.additions === "number" ? item.additions : 0,
    deletions: typeof item.deletions === "number" ? item.deletions : 0,
    diff: typeof item.diff === "string" ? item.diff : "",
  };
}

function normalizeType(value: unknown): FileDiff["type"] {
  if (typeof value === "string" && ["modified", "added", "deleted"].includes(value)) {
    return value as FileDiff["type"];
  }
  return "modified";
}

function parseFileStatusArray(body: unknown): FileStatus[] {
  if (!Array.isArray(body)) {
    const wrapped = body as { data?: unknown };
    if (wrapped.data && Array.isArray(wrapped.data)) {
      return (wrapped.data as unknown[]).filter(isFileStatusLike).map(toFileStatus);
    }
    return [];
  }
  return (body as unknown[]).filter(isFileStatusLike).map(toFileStatus);
}

function isFileStatusLike(item: unknown): item is Record<string, unknown> {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return typeof record.path === "string";
}

const VALID_FILE_STATUSES: ReadonlySet<string> = new Set([
  "modified",
  "added",
  "deleted",
  "untracked",
  "unchanged",
]);

function toFileStatus(item: Record<string, unknown>): FileStatus {
  const raw = typeof item.status === "string" ? item.status : "";
  const status: FileStatus["status"] = VALID_FILE_STATUSES.has(raw)
    ? (raw as FileStatus["status"])
    : "untracked";
  return {
    path: String(item.path ?? ""),
    status,
    staged: typeof item.staged === "boolean" ? item.staged : false,
  };
}
