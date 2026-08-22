import {
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
  hasRuntimeType,
  type JsonValue,
  jsonValueSchema,
} from "@openducktor/contracts";
import { selectRenderableFileDiff } from "@openducktor/core";
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
    `/session/${externalSessionId}/diff`,
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
  const url = new URL("/file/status", normalizeRuntimeEndpoint(runtimeEndpoint));

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

const fetchJson = async (action: string, url: URL, timeoutMs: number): Promise<JsonValue> => {
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

  return jsonValueSchema.parse(await response.json());
};

type OpenCodeDiffResponse = {
  additions?: JsonValue;
  data?: JsonValue;
  deletions?: JsonValue;
  file?: JsonValue;
  patch?: JsonValue;
  status?: JsonValue;
};

const isResponseRecord = (value: JsonValue): value is OpenCodeDiffResponse =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseFileDiffArray(body: JsonValue): FileDiff[] {
  const payload = readArrayPayload("load session diff", body);
  const standardPayload = fileDiffSchema.array().safeParse(payload);
  if (standardPayload.success) {
    return standardPayload.data.map(toRenderableFileDiff);
  }

  return payload.map((entry, index) => parseSnapshotFileDiff(entry, index));
}

function parseFileStatusArray(body: JsonValue): FileStatus[] {
  return fileStatusSchema.array().parse(readArrayPayload("load file status", body));
}

function readArrayPayload(action: string, body: JsonValue): JsonValue[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (isResponseRecord(body)) {
    const data = body.data;
    if (Array.isArray(data)) {
      return data;
    }
  }

  throw toOpenCodeRequestError(action, new Error("unexpected response payload shape"));
}

function parseSnapshotFileDiff(entry: JsonValue, index: number): FileDiff {
  if (!isResponseRecord(entry)) {
    throw new Error(`unexpected OpenCode diff entry at index ${index}: expected an object`);
  }

  const file = entry.file;
  const patch = entry.patch;
  const additions = entry.additions;
  const deletions = entry.deletions;
  const status = entry.status;
  const parsedFile = hasRuntimeType(file, "string") ? file : null;
  const parsedPatch = hasRuntimeType(patch, "string") ? patch : null;
  const parsedAdditions =
    hasRuntimeType(additions, "number") && Number.isFinite(additions) ? additions : null;
  const parsedDeletions =
    hasRuntimeType(deletions, "number") && Number.isFinite(deletions) ? deletions : null;
  const type =
    hasRuntimeType(status, "string") && status.trim().length > 0
      ? status
      : status == null
        ? "modified"
        : null;
  const invalidFields = [
    parsedFile === null ? "file" : null,
    parsedPatch === null ? "patch" : null,
    parsedAdditions === null ? "additions" : null,
    parsedDeletions === null ? "deletions" : null,
    type ? null : "status",
  ].filter((field): field is string => Boolean(field));
  if (
    invalidFields.length > 0 ||
    parsedFile === null ||
    parsedPatch === null ||
    parsedAdditions === null ||
    parsedDeletions === null ||
    type === null
  ) {
    throw new Error(
      `unexpected OpenCode diff entry at index ${index}: invalid ${invalidFields.join(", ")} fields`,
    );
  }

  return toRenderableFileDiff({
    file: parsedFile,
    type,
    additions: parsedAdditions,
    deletions: parsedDeletions,
    diff: parsedPatch,
  });
}

function toRenderableFileDiff(entry: FileDiff): FileDiff {
  return {
    file: entry.file,
    type: entry.type,
    additions: entry.additions,
    deletions: entry.deletions,
    diff: selectRenderableFileDiff(entry.diff, entry.file, { changeType: entry.type }) ?? "",
  };
}
