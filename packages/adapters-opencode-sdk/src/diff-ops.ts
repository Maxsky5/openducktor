import {
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
} from "@openducktor/contracts";
import { toOpenCodeRequestError } from "./request-errors";

/**
 * Loads session diffs from the OpenCode SDK API.
 * Endpoint: GET /session/:id/diff?messageID=...
 *
 */
export const loadSessionDiff = async (
  runtimeEndpoint: string,
  externalSessionId: string,
  runtimeHistoryAnchor?: string,
): Promise<FileDiff[]> => {
  const url = new URL(
    `/api/session/${externalSessionId}/diff`,
    normalizeRuntimeEndpoint(runtimeEndpoint),
  );
  if (runtimeHistoryAnchor) {
    url.searchParams.set("messageID", runtimeHistoryAnchor);
  }

  try {
    const body = await fetchJson("load session diff", url, 15_000);
    return parseFileDiffArray(body);
  } catch (error) {
    throw toOpenCodeRequestError("load session diff", error);
  }
};

/**
 * Loads file status from the OpenCode SDK API.
 * Endpoint: GET /file/status
 */
export const loadFileStatus = async (runtimeEndpoint: string): Promise<FileStatus[]> => {
  const url = new URL("/api/file/status", normalizeRuntimeEndpoint(runtimeEndpoint));

  try {
    const body = await fetchJson("load file status", url, 10_000);
    return parseFileStatusArray(body);
  } catch (error) {
    throw toOpenCodeRequestError("load file status", error);
  }
};

function normalizeRuntimeEndpoint(runtimeEndpoint: string): string {
  return runtimeEndpoint.endsWith("/") ? runtimeEndpoint.slice(0, -1) : runtimeEndpoint;
}

const fetchJson = async (action: string, url: URL, timeoutMs: number): Promise<unknown> => {
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw toOpenCodeRequestError(action, undefined, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response.json();
};

function parseFileDiffArray(body: unknown): FileDiff[] {
  return fileDiffSchema.array().parse(readArrayPayload("load session diff", body));
}

function parseFileStatusArray(body: unknown): FileStatus[] {
  return fileStatusSchema.array().parse(readArrayPayload("load file status", body));
}

function readArrayPayload(action: string, body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === "object") {
    const wrapped = body as { data?: unknown };
    if (Array.isArray(wrapped.data)) {
      return wrapped.data;
    }
  }

  throw toOpenCodeRequestError(action, new Error("unexpected response payload shape"));
}
