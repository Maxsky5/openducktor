import {
  OpenCode,
  ClientError,
  isSessionNotFoundError,
  type OpenCodeClient,
  type SessionInfo,
} from "@opencode/client";
import {
  openCodeMigrationObservationSchema,
  type RuntimeOperationFailure,
} from "@openducktor/contracts";
import { z } from "zod";
import type { OpenCodeRuntimeConnection } from "./types";

export type OperationIdentity = {
  repoPath: string;
  workingDirectory?: string;
  externalSessionId?: string;
};

export class OpenCodeOperationError extends Error {
  readonly failure: { kind: "runtime_operation"; runtimeOperationFailure: RuntimeOperationFailure };

  constructor(detail: RuntimeOperationFailure, cause?: unknown) {
    super(`${detail.summary} ${detail.nativeReason ?? ""} ${detail.nextAction}`.trim(), { cause });
    this.name = "OpenCodeOperationError";
    this.failure = { kind: "runtime_operation", runtimeOperationFailure: detail };
  }
}

export const operationError = (
  identity: OperationIdentity,
  operation: string,
  code: RuntimeOperationFailure["code"],
  reason: string,
  nextAction = "Check the selected OpenCode V2 runtime and retry this action.",
): OpenCodeOperationError =>
  new OpenCodeOperationError({
    repoPath: identity.repoPath,
    workingDirectory: identity.workingDirectory,
    externalSessionId: identity.externalSessionId,
    runtimeKind: "opencode",
    operation,
    code,
    summary: `OpenCode could not ${operation}${identity.externalSessionId ? ` for conversation '${identity.externalSessionId}'` : ""}.`,
    nativeReason: reason,
    nextAction,
  });

// The SDK accepts readonly request objects. Builders add optional fields before submission.
export type OpenCodeRequestDraft<Input> = { -readonly [Field in keyof Input]: Input[Field] };

export const createOpenCodeClient = (
  connection: OpenCodeRuntimeConnection,
  signal?: AbortSignal,
): OpenCodeClient => {
  const config = {
    baseUrl: connection.endpoint,
    headers: {
      Authorization: `Basic ${Buffer.from(`${connection.authentication.username}:${connection.authentication.password}`).toString("base64")}`,
    },
  };
  if (!signal) return OpenCode.make(config);
  const fetchWithAbort = Object.assign(
    (resource: Parameters<typeof fetch>[0], init?: RequestInit) =>
      fetch(resource, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
    fetch,
  );
  return OpenCode.make({ ...config, fetch: fetchWithAbort });
};

export const assertOpenCodeV2Connection = async (
  connection: OpenCodeRuntimeConnection,
  signal?: AbortSignal,
): Promise<void> => {
  const client = createOpenCodeClient(connection);
  try {
    z.object({ version: z.string().regex(/^2\./), pid: z.number().int().positive() }).parse(
      await client.server.info(signal ? { signal } : undefined),
    );
  } catch {
    throw operationError(
      { repoPath: "OpenCode executable" },
      "connect to the V2 server",
      "runtime_unavailable",
      "The selected executable did not provide an authenticated OpenCode V2 server.",
      "Install OpenCode V2 or select its executable in runtime settings.",
    );
  }
};

export const readMigration = async (
  client: OpenCodeClient,
  identity: OperationIdentity,
  operation: string,
) => {
  const migration = openCodeMigrationObservationSchema.parse(await client.migration.v1.status());
  if (migration.status !== "completed") {
    throw new OpenCodeOperationError({
      repoPath: identity.repoPath,
      workingDirectory: identity.workingDirectory,
      externalSessionId: identity.externalSessionId,
      runtimeKind: "opencode",
      operation,
      code: "migration_blocked",
      summary: `OpenCode native migration prevents '${operation}'.`,
      migration,
      nativeReason:
        migration.status === "error"
          ? migration.error
          : migration.status === "running"
            ? `${migration.progress.label}${migration.progress.numerator !== undefined ? ` (${migration.progress.numerator}${migration.progress.denominator !== undefined ? `/${migration.progress.denominator}` : ""})` : ""}`
            : "Native V1 migration is required.",
      nextAction:
        migration.status === "error"
          ? "Resolve the native migration error in OpenCode, then retry this action."
          : "Finish native migration in OpenCode, then retry this action.",
    });
  }
  return migration;
};

export const nativeRequest = async <A>(
  identity: OperationIdentity,
  operation: string,
  run: () => Promise<A>,
): Promise<A> => {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof OpenCodeOperationError) throw cause;
    const code = isSessionNotFoundError(cause)
      ? "session_not_found"
      : cause instanceof z.ZodError ||
          (cause instanceof ClientError && cause.reason === "MalformedResponse")
        ? "invalid_runtime_response"
        : "request_failed";
    const reason =
      cause instanceof Error
        ? cause.message
        : (z.object({ message: z.string() }).safeParse(cause).data?.message ??
          "The native request failed.");
    throw operationError(
      identity,
      operation,
      code,
      reason,
      code === "session_not_found"
        ? "Check native migration and the exact conversation in OpenCode, then retry. The saved link is unchanged."
        : "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
    );
  }
};

export const verifySession = (detail: SessionInfo, identity: OperationIdentity): SessionInfo => {
  const parsed = z
    .object({
      id: z.string().min(1),
      location: z.object({ directory: z.string().min(1) }),
      time: z.object({ created: z.number().finite(), updated: z.number().finite() }),
    })
    .parse(detail);
  if (
    (identity.externalSessionId && parsed.id !== identity.externalSessionId) ||
    (identity.workingDirectory && parsed.location.directory !== identity.workingDirectory)
  )
    throw operationError(
      identity,
      "open the linked conversation",
      "identity_mismatch",
      `The native conversation returned ID '${parsed.id}' in '${parsed.location.directory}'.`,
      "Check the linked conversation and its directory in OpenCode, then retry. The saved association is unchanged.",
    );
  return detail;
};
