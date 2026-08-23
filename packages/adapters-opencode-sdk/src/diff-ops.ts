import {
  type ExactOptional,
  type FileDiff,
  type FileStatus,
  exactOptionalSchema,
} from "@openducktor/contracts";
import { selectRenderableFileDiff } from "@openducktor/core";
import type { File as OpenCodeFileStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client";
import { toOpenCodeRequestError } from "./request-errors";
import { z } from "zod";

const openCodeSnapshotFileDiffSchema = exactOptionalSchema(
  z.object({
    file: z.string().optional(),
    patch: z.string().optional(),
    additions: z.number().finite(),
    deletions: z.number().finite(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  }),
) satisfies z.ZodType<ExactOptional<SnapshotFileDiff>>;

const openCodeFileStatusSchema = z.object({
  path: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  status: z.enum(["added", "deleted", "modified"]),
}) satisfies z.ZodType<OpenCodeFileStatus>;
const openCodeSessionDiffPayloadSchema = openCodeSnapshotFileDiffSchema.array();
const openCodeFileStatusPayloadSchema = openCodeFileStatusSchema.array();

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
    const body = await fetchJson(
      "load session diff",
      url,
      15_000,
      openCodeSessionDiffPayloadSchema,
    );
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
    const body = await fetchJson("load file status", url, 10_000, openCodeFileStatusPayloadSchema);
    return parseFileStatusArray(body);
  } catch (error) {
    throw toOpenCodeRequestError("load file status", error);
  }
};

function normalizeRuntimeEndpoint(runtimeEndpoint: string): string {
  return runtimeEndpoint.endsWith("/") ? runtimeEndpoint.slice(0, -1) : runtimeEndpoint;
}

const fetchJson = async <Payload>(
  action: string,
  url: URL,
  timeoutMs: number,
  schema: z.ZodType<Payload>,
): Promise<Payload> => {
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

  return schema.parse(await response.json());
};

function parseFileDiffArray(body: ExactOptional<SnapshotFileDiff>[]): FileDiff[] {
  return body.map((entry, index) => parseSnapshotFileDiff(entry, index));
}

function parseFileStatusArray(body: OpenCodeFileStatus[]): FileStatus[] {
  return body.map((entry) => ({
    path: entry.path,
    status: entry.status,
    staged: false,
  }));
}

function parseSnapshotFileDiff(entry: ExactOptional<SnapshotFileDiff>, index: number): FileDiff {
  const file = entry.file;
  const patch = entry.patch;
  const status = entry.status;
  const missingFields = [
    file === undefined ? "file" : null,
    patch === undefined ? "patch" : null,
    status === undefined ? "status" : null,
  ].filter((field): field is string => field !== null);
  if (file === undefined || patch === undefined || status === undefined) {
    throw new Error(
      `unexpected OpenCode diff entry at index ${index}: missing ${missingFields.join(", ")} fields`,
    );
  }

  return toRenderableFileDiff({
    file,
    type: status,
    additions: entry.additions,
    deletions: entry.deletions,
    diff: patch,
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
