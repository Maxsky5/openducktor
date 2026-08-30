import {
  jsonValueSchema,
  parseCodexAppServerClientRequest,
  parseCodexAppServerRequestResult,
  type CodexAppServerApprovalsReviewer,
  type CodexAppServerAskForApproval,
  type CodexAppServerClientRequestMap,
  type CodexAppServerSandboxMode,
  type CodexAppServerSandboxPolicy,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import type {
  CodexAppServerService,
  CodexAppServerServiceError,
} from "../../application/runtimes/codex-app-server-service";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../../composition/host-lifecycle";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerRequestInput,
  CodexAppServerRequestMethod,
} from "../../ports/codex-app-server-port";
import { CODEX_APP_SERVER_REQUEST_METHODS } from "../../ports/codex-app-server-port";
import type { CodexAppServerRequestResult } from "../../ports/codex-app-server-protocol";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

type CodexAppServerCommandHandlerOptions = {
  logger?: HostLifecycleLogger;
  onBackgroundFailure(failure: HostOperationErrorAggregate): Effect.Effect<void, never>;
};

const defaultCodexAppServerCommandHandlerOptions: CodexAppServerCommandHandlerOptions = {
  onBackgroundFailure: () => Effect.void,
};

const nonBlankString = (value: string | null | undefined): string | undefined =>
  value !== null && value !== undefined && value.trim().length > 0 ? value : undefined;

type CodexScalarApprovalPolicy = Extract<CodexAppServerAskForApproval, string>;

const approvalPolicyLogValue = (
  approvalPolicy: CodexAppServerAskForApproval | null | undefined,
): CodexScalarApprovalPolicy | undefined => {
  switch (approvalPolicy) {
    case "never":
    case "on-request":
    case "untrusted":
      return approvalPolicy;
    default:
      return undefined;
  }
};

const sandboxModeFromSandboxPolicy = (
  sandboxPolicy: CodexAppServerSandboxPolicy | null | undefined,
): CodexAppServerSandboxMode | "externalSandbox" | undefined => {
  switch (sandboxPolicy?.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "readOnly":
      return "read-only";
    case "workspaceWrite":
      return "workspace-write";
    case "externalSandbox":
      return "externalSandbox";
    default:
      return undefined;
  }
};

const networkAccessFromSandboxPolicy = (
  sandboxPolicy: CodexAppServerSandboxPolicy | null | undefined,
): string | undefined => {
  switch (sandboxPolicy?.type) {
    case "dangerFullAccess":
      return "unrestricted";
    case "externalSandbox":
      return sandboxPolicy.networkAccess;
    case "readOnly":
    case "workspaceWrite":
      return String(sandboxPolicy.networkAccess);
    default:
      return undefined;
  }
};

const cwdFromSandboxPolicy = (
  sandboxPolicy: CodexAppServerSandboxPolicy | null | undefined,
): string | undefined => {
  if (sandboxPolicy?.type !== "workspaceWrite") {
    return undefined;
  }
  return nonBlankString(sandboxPolicy.writableRoots[0]);
};

type CodexPolicyRequestMethod = "thread/start" | "thread/resume" | "thread/fork" | "turn/start";
type CodexPolicyRequestInput = Extract<
  CodexAppServerRequestInput,
  { method: CodexPolicyRequestMethod }
>;
type CodexThreadPolicyRequestInput = Extract<
  CodexPolicyRequestInput,
  { method: "thread/start" | "thread/resume" | "thread/fork" }
>;
type CodexThreadPolicyResult =
  | CodexAppServerClientRequestMap["thread/start"]["result"]
  | CodexAppServerClientRequestMap["thread/resume"]["result"]
  | CodexAppServerClientRequestMap["thread/fork"]["result"];

type CodexPolicyLogFields = {
  threadId: string | undefined;
  cwd: string | undefined;
  sandboxMode: CodexAppServerSandboxMode | "externalSandbox" | undefined;
  approvalPolicy: CodexScalarApprovalPolicy | undefined;
  approvalsReviewer: CodexAppServerApprovalsReviewer | undefined;
  networkAccess: string | undefined;
};

const writeCodexPolicyLog = (
  logger: HostLifecycleLogger,
  input: CodexPolicyRequestInput,
  fields: CodexPolicyLogFields,
): Effect.Effect<void, HostOperationError> =>
  writeHostLifecycleLog(
    logger,
    "info",
    [
      `Codex session policy ${input.method}`,
      `runtime=${input.runtimeId}`,
      `thread=${fields.threadId ?? "unknown"}`,
      `cwd=${fields.cwd ?? "unknown"}`,
      `sandboxMode=${fields.sandboxMode ?? "unknown"}`,
      `approvalPolicy=${fields.approvalPolicy ?? "unknown"}`,
      `promptReviewer=${fields.approvalsReviewer ?? "unknown"}`,
      `networkAccess=${fields.networkAccess ?? "unknown"}`,
    ].join(" "),
  );

const parsePolicyResult = <Method extends CodexPolicyRequestMethod>(
  method: Method,
  result: CodexAppServerRequestResult,
): Effect.Effect<
  CodexAppServerClientRequestMap[Method]["result"],
  HostOperationError<{ method: Method }>
> =>
  Effect.try({
    try: () => parseCodexAppServerRequestResult(method, result),
    catch: (cause) =>
      new HostOperationError({
        operation: "codex-app-server.policy-result",
        message: `Invalid Codex app-server result for method ${method}`,
        cause,
        details: { method },
      }),
  });

const writeCodexThreadPolicyLog = (
  logger: HostLifecycleLogger,
  input: CodexThreadPolicyRequestInput,
  result: CodexThreadPolicyResult,
  threadId: string,
): Effect.Effect<void, HostOperationError> =>
  writeCodexPolicyLog(logger, input, {
    threadId,
    cwd: nonBlankString(input.params.cwd) ?? nonBlankString(result.cwd),
    sandboxMode: input.params.sandbox ?? sandboxModeFromSandboxPolicy(result.sandbox),
    approvalPolicy:
      approvalPolicyLogValue(input.params.approvalPolicy) ??
      approvalPolicyLogValue(result.approvalPolicy),
    approvalsReviewer: input.params.approvalsReviewer ?? result.approvalsReviewer,
    networkAccess: networkAccessFromSandboxPolicy(result.sandbox),
  });

const logCodexPolicyRequest = (
  logger: HostLifecycleLogger | undefined,
  input: CodexAppServerRequestInput,
  result: CodexAppServerRequestResult,
): Effect.Effect<void, HostOperationErrorAggregate> => {
  if (!logger) {
    return Effect.void;
  }

  switch (input.method) {
    case "thread/start":
      return parsePolicyResult(input.method, result).pipe(
        Effect.flatMap((parsedResult) =>
          writeCodexThreadPolicyLog(logger, input, parsedResult, parsedResult.thread.id),
        ),
      );
    case "thread/resume":
      return parsePolicyResult(input.method, result).pipe(
        Effect.flatMap((parsedResult) =>
          writeCodexThreadPolicyLog(
            logger,
            input,
            parsedResult,
            nonBlankString(input.params.threadId) ?? parsedResult.thread.id,
          ),
        ),
      );
    case "thread/fork":
      return parsePolicyResult(input.method, result).pipe(
        Effect.flatMap((parsedResult) =>
          writeCodexThreadPolicyLog(
            logger,
            input,
            parsedResult,
            nonBlankString(input.params.threadId) ?? parsedResult.thread.id,
          ),
        ),
      );
    case "turn/start":
      return parsePolicyResult(input.method, result).pipe(
        Effect.flatMap(() =>
          writeCodexPolicyLog(logger, input, {
            threadId: nonBlankString(input.params.threadId),
            cwd:
              nonBlankString(input.params.cwd) ?? cwdFromSandboxPolicy(input.params.sandboxPolicy),
            sandboxMode: sandboxModeFromSandboxPolicy(input.params.sandboxPolicy),
            approvalPolicy: approvalPolicyLogValue(input.params.approvalPolicy),
            approvalsReviewer: input.params.approvalsReviewer ?? undefined,
            networkAccess: networkAccessFromSandboxPolicy(input.params.sandboxPolicy),
          }),
        ),
      );
    default:
      return Effect.void;
  }
};

const isCodexRequestMethod = (method: string): method is CodexAppServerRequestMethod =>
  CODEX_APP_SERVER_REQUEST_METHODS.some((candidate) => candidate === method);

const requireCodexRequestMethod = (
  result: z.ZodSafeParseResult<string>,
): CodexAppServerRequestMethod => {
  const method = requireString(result, "method");
  if (!isCodexRequestMethod(method)) {
    throw new HostValidationError({
      message: `Unsupported Codex app-server request method: ${method}`,
      field: "method",
      details: { method },
    });
  }
  return method;
};

const parseRequestInput = (args: HostCommandArgs): CodexAppServerRequestInput => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "codex_app_server_request input",
  );
  const runtimeId = requireString(
    commandInputStringSchema.safeParse(record.runtimeId),
    "runtimeId",
  );
  const method = requireCodexRequestMethod(commandInputStringSchema.safeParse(record.method));
  const parsedParams = jsonValueSchema.safeParse(record.params);
  if (!parsedParams.success) {
    throw new HostValidationError({
      message: "params must be JSON-serializable.",
      field: "params",
      cause: parsedParams.error,
      details: { method },
    });
  }
  let request;
  try {
    request = parseCodexAppServerClientRequest({ method, params: parsedParams.data });
  } catch (cause) {
    throw new HostValidationError({
      message: `Invalid Codex app-server request params for method ${method}`,
      field: "params",
      cause,
      details: { method },
    });
  }
  return {
    runtimeId,
    ...request,
  };
};

const requestCodexAppServer = (
  service: CodexAppServerService,
  input: CodexAppServerRequestInput,
): Effect.Effect<CodexAppServerRequestResult, CodexAppServerServiceError> => {
  if (input.method !== "thread/turns/list") {
    return service.request(input);
  }

  const { cursor, itemsView, limit, sortDirection, threadId } = input.params;
  const listInput: Parameters<CodexAppServerService["listThreadTurns"]>[0] = {
    runtimeId: input.runtimeId,
    threadId: requireString(commandInputStringSchema.safeParse(threadId), "threadId"),
  };
  if (cursor !== undefined) {
    listInput.cursor =
      cursor === null ? null : requireString(commandInputStringSchema.safeParse(cursor), "cursor");
  }
  if (limit !== undefined) {
    if (limit !== null && limit <= 0) {
      throw new HostValidationError({
        message: "limit must be a positive integer.",
        field: "limit",
      });
    }
    listInput.limit = limit;
  }
  if (sortDirection !== undefined) {
    listInput.sortDirection = sortDirection;
  }
  if (itemsView !== undefined) {
    listInput.itemsView = itemsView;
  }
  return service.listThreadTurns(listInput);
};

export const createCodexAppServerCommandHandlers = (
  codexAppServerService: CodexAppServerService,
  options: CodexAppServerCommandHandlerOptions = defaultCodexAppServerCommandHandlerOptions,
) =>
  ({
    codex_app_server_request: (args) => {
      const input = parseRequestInput(args);
      return requestCodexAppServer(codexAppServerService, input).pipe(
        Effect.tap((result) =>
          Effect.either(logCodexPolicyRequest(options.logger, input, result)).pipe(
            Effect.flatMap((loggingResult) =>
              loggingResult._tag === "Left"
                ? options.onBackgroundFailure(loggingResult.left)
                : Effect.void,
            ),
          ),
        ),
      );
    },
  }) satisfies HostCommandHandlerDefinitions;
