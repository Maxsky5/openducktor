import { access } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type {
  QaWorkflowVerdict,
  RepoStoreHealth,
  TaskMetadataDocument,
  TaskMetadataPayload,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type BeadsCliContext,
  sharedServerHealthFromContext,
} from "../../../adapters/beads/beads-cli-context";
import { HostValidationError, toHostOperationError } from "../../../effect/host-errors";
import {
  DOCUMENT_ENCODING_GZIP_BASE64_V1,
  isRecord,
  METADATA_NAMESPACE,
  type RawBdWherePayload,
  type ResolveBeadsCliContext,
  type RunBdJson,
} from "./beads-raw-issue";
export const metadataNamespace = (metadata: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const namespace = metadata[METADATA_NAMESPACE];
  return isRecord(namespace) ? namespace : undefined;
};
export const documentsMetadata = (
  namespace: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  const documents = namespace?.documents;
  return isRecord(documents) ? documents : undefined;
};
export const decodeMarkdownPayload = (payload: string, encoding: string): string => {
  if (encoding !== DOCUMENT_ENCODING_GZIP_BASE64_V1) {
    throw new HostValidationError({
      message: `Unsupported document encoding: ${encoding}`,
      field: "encoding",
      details: { encoding },
    });
  }
  return gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
};
export const documentDecodeError = (path: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Failed to decode ${path}: ${message}`;
};
export const unavailableSharedServer = (): RepoStoreHealth["sharedServer"] => ({
  host: null,
  port: null,
  ownershipState: "unavailable",
});
export const repoStoreHealth = ({
  category,
  status,
  detail,
  attachmentPath,
  databaseName,
  sharedServer,
}: {
  category: RepoStoreHealth["category"];
  status: RepoStoreHealth["status"];
  detail: string | null;
  attachmentPath: string | null;
  databaseName: string | null;
  sharedServer?: RepoStoreHealth["sharedServer"] | undefined;
}): RepoStoreHealth => ({
  category,
  status,
  isReady: status === "ready",
  detail,
  attachment: {
    path: attachmentPath,
    databaseName,
  },
  sharedServer: sharedServer ?? unavailableSharedServer(),
});
export const degradedRepoStoreHealth = (
  detail: string,
  context: BeadsCliContext | null = null,
): RepoStoreHealth =>
  repoStoreHealth({
    category: "attachment_verification_failed",
    status: "degraded",
    detail,
    attachmentPath: context?.beadsDir ?? null,
    databaseName: context?.databaseName ?? null,
    sharedServer: context ? sharedServerHealthFromContext(context) : undefined,
  });
export const parseBdWherePayload = (payload: unknown): RawBdWherePayload => {
  if (!isRecord(payload)) {
    throw new HostValidationError({
      message: "bd where payload must be an object",
      details: { context: "bd where" },
    });
  }
  return {
    path: payload.path,
    error: payload.error,
  };
};
export const repoStoreHealthFromBdWherePayload = (
  payload: unknown,
  context: BeadsCliContext,
): RepoStoreHealth => {
  let wherePayload: RawBdWherePayload;
  try {
    wherePayload = parseBdWherePayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return degradedRepoStoreHealth(`Failed to decode bd where payload: ${message}`, context);
  }
  const rawPath = wherePayload.path;
  const rawError = wherePayload.error;
  const path = typeof rawPath === "string" ? rawPath.trim() : null;
  const error = typeof rawError === "string" ? rawError.trim() : null;
  if (path && error) {
    return degradedRepoStoreHealth("bd where --json returned both path and error", context);
  }
  if (path) {
    if (path !== context.beadsDir) {
      return degradedRepoStoreHealth(
        `Beads attachment resolves to ${path}, expected ${context.beadsDir}`,
        context,
      );
    }
    return repoStoreHealth({
      category: "healthy",
      status: "ready",
      detail: "Beads attachment and shared Dolt server are healthy.",
      attachmentPath: context.beadsDir,
      databaseName: context.databaseName,
      sharedServer: sharedServerHealthFromContext(context),
    });
  }
  if (error) {
    return degradedRepoStoreHealth(error, context);
  }
  return degradedRepoStoreHealth(
    "bd where --json returned a payload without path or error",
    context,
  );
};
export const pathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => access(inputPath),
    catch: (cause) => toHostOperationError(cause, "beads.pathExists"),
  }).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
export const diagnoseRepoStoreWithBd = (
  runBdJson: RunBdJson,
  repoPath: string,
  resolveCliContext: ResolveBeadsCliContext,
  prepare: boolean,
) =>
  Effect.gen(function* () {
    const contextResult = yield* resolveCliContext(repoPath, { requireSharedServer: prepare }).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "beads.diagnose.resolveCliContext", { repoPath, prepare }),
      ),
      Effect.either,
    );
    if (contextResult._tag === "Left") {
      const message =
        contextResult.left instanceof Error
          ? contextResult.left.message
          : String(contextResult.left);
      return repoStoreHealth({
        category: "check_call_failed",
        status: "blocking",
        detail: `Failed to resolve Beads store context: ${message}`,
        attachmentPath: null,
        databaseName: null,
      });
    }
    const context = contextResult.right;
    const attachmentExists = yield* pathExists(context.beadsDir);
    if (!attachmentExists) {
      return repoStoreHealth({
        category: "missing_attachment",
        status: "blocking",
        detail: `Beads attachment is missing at ${context.beadsDir}`,
        attachmentPath: context.beadsDir,
        databaseName: context.databaseName,
        sharedServer: sharedServerHealthFromContext(context),
      });
    }
    if (!context.sharedServer) {
      return repoStoreHealth({
        category: "shared_server_unavailable",
        status: "blocking",
        detail: `Shared Dolt server state is missing at ${context.serverStatePath}`,
        attachmentPath: context.beadsDir,
        databaseName: context.databaseName,
        sharedServer: sharedServerHealthFromContext(context),
      });
    }
    const whereResult = yield* runBdJson(repoPath, ["where"], context).pipe(Effect.either);
    if (whereResult._tag === "Left") {
      const message =
        whereResult.left instanceof Error ? whereResult.left.message : String(whereResult.left);
      return degradedRepoStoreHealth(message, context);
    }
    return repoStoreHealthFromBdWherePayload(whereResult.right, context);
  });
export const optionalDocumentRevision = (entry: Record<string, unknown>): number | undefined => {
  const revision = entry.revision;
  return typeof revision === "number" && Number.isInteger(revision) && revision > 0
    ? revision
    : undefined;
};
export const readMarkdownDocumentEntry = (
  entry: unknown,
  metadataPath: string,
  index: number,
): TaskMetadataDocument => {
  const path = `${metadataPath}[${index}]`;
  if (!isRecord(entry)) {
    return {
      markdown: "",
      error: `Failed to read ${path}: expected an object`,
    };
  }
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : undefined;
  const revision = optionalDocumentRevision(entry);
  const payload = entry.markdown;
  if (typeof payload !== "string") {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: `${path}.markdown must be a string`,
    };
  }
  const encoding = entry.encoding;
  if (encoding === undefined || encoding === null) {
    return { markdown: payload, updatedAt, revision };
  }
  if (typeof encoding !== "string") {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: `${path}.encoding must be a string`,
    };
  }
  try {
    return {
      markdown: decodeMarkdownPayload(payload, encoding),
      updatedAt,
      revision,
    };
  } catch (error) {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: documentDecodeError(path, error),
    };
  }
};
export const readLatestMarkdownDocument = (
  value: unknown,
  metadataPath: string,
): TaskMetadataDocument => {
  if (value === undefined) {
    return { markdown: "" };
  }
  if (!Array.isArray(value)) {
    return {
      markdown: "",
      error: `Failed to read ${metadataPath}: expected an array`,
    };
  }
  if (value.length === 0) {
    return { markdown: "" };
  }
  const index = value.length - 1;
  return readMarkdownDocumentEntry(value[index], metadataPath, index);
};
export const readLatestQaDocument = (
  value: unknown,
  metadataPath: string,
): TaskMetadataPayload["qaReport"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return {
      markdown: "",
      verdict: "not_reviewed",
      error: `Failed to read ${metadataPath}: expected an array`,
    };
  }
  if (value.length === 0) {
    return undefined;
  }
  const index = value.length - 1;
  const entry = value[index];
  const document = readMarkdownDocumentEntry(entry, metadataPath, index);
  const verdict = isRecord(entry) ? entry.verdict : undefined;
  const parsedVerdict = verdict === "approved" || verdict === "rejected" ? verdict : "not_reviewed";
  const verdictError =
    parsedVerdict === "not_reviewed" && isRecord(entry)
      ? `${metadataPath}[${index}].verdict must be one of approved or rejected`
      : undefined;
  return {
    ...document,
    verdict: parsedVerdict,
    error: document.error ?? verdictError,
  };
};
export const documentPresence = (value: unknown): boolean => {
  if (value === undefined) {
    return false;
  }
  if (!Array.isArray(value)) {
    return true;
  }
  const entry = value.at(-1);
  if (entry === undefined) {
    return false;
  }
  if (!isRecord(entry)) {
    return true;
  }
  const payload = entry.markdown;
  if (typeof payload !== "string") {
    return true;
  }
  if ("encoding" in entry) {
    if (typeof entry.encoding !== "string") {
      return true;
    }
    try {
      return decodeMarkdownPayload(payload, entry.encoding).trim().length > 0;
    } catch {
      return true;
    }
  }
  return payload.trim().length > 0;
};
export const latestEntry = (value: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entry = value.at(-1);
  return isRecord(entry) ? entry : undefined;
};
export const latestUpdatedAt = (value: unknown): string | undefined => {
  const entry = latestEntry(value);
  return typeof entry?.updatedAt === "string" ? entry.updatedAt : undefined;
};
export const latestQaVerdict = (value: unknown): QaWorkflowVerdict => {
  const entry = latestEntry(value);
  if (entry?.verdict === "approved" || entry?.verdict === "rejected") {
    return entry.verdict;
  }
  return "not_reviewed";
};
export const markdownDocumentPresence = (value: unknown) => {
  if (!documentPresence(value)) {
    return { has: false };
  }
  return {
    has: true,
    updatedAt: latestUpdatedAt(value),
  };
};
export const qaDocumentPresence = (value: unknown) => {
  const has = documentPresence(value);
  return {
    has,
    updatedAt: has ? latestUpdatedAt(value) : undefined,
    verdict: latestQaVerdict(value),
  };
};
