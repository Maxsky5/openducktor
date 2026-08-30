import type { CanUseTool, SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { type OdtToolName, toClaudeOdtToolAliases } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentRole,
  AgentSessionWorkflowScope,
  AgentStreamPart,
  SessionRef,
} from "@openducktor/core";
import { isOdtMutationToolName, normalizeOdtToolName } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  type ClaudeProtocolObject,
  claudeProtocolObjectSchema,
} from "./claude-agent-sdk-ingress-schemas";
import type {
  ClaudeAgentSdkServiceError,
  ClaudeSessionContext,
  ClaudeSessionInput,
} from "./claude-agent-sdk-types";

type ClaudeAssistantSdkMessage = Extract<SDKMessage, { type: "assistant" }>["message"];
type ClaudeAssistantContentBlock = ClaudeAssistantSdkMessage["content"][number];
type ClaudeTaskNotification = Extract<SDKMessage, { subtype: "task_notification" }>;
export type ClaudeTaskUpdatedPatch = Extract<SDKMessage, { subtype: "task_updated" }>["patch"];
export type ClaudeFailureDetails = {
  readonly description?: string;
  readonly error?: string;
  readonly message?: string;
  readonly reason?: string;
  readonly summary?: string;
};
type ClaudeStringPropertySource =
  | ClaudeAssistantContentBlock
  | ClaudeAssistantSdkMessage
  | ClaudeTaskNotification
  | ClaudeTaskUpdatedPatch
  | ClaudeFailureDetails
  | ClaudeProtocolObject
  | Parameters<CanUseTool>[1]
  | undefined;

export const INIT_TIMEOUT_MS = 60_000;
export const FILE_SEARCH_LIMIT = 30;
export const FILE_SEARCH_MAX_VISITED = 4_000;
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  ".vite",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

export const fromPromise = <A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, ClaudeAgentSdkServiceError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      if (cause instanceof HostValidationError || cause instanceof HostOperationError) {
        return cause;
      }
      return new HostOperationError({
        operation,
        message: errorMessage(cause),
        cause,
      });
    },
  });

export const withTimeout = async <A>(
  promise: Promise<A>,
  timeoutMs: number,
  message: string,
): Promise<A> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const claudeTextSchema = z.string();
const claudeContentBlockSchema = z.looseObject({
  text: z.string().optional(),
  type: z.string().optional(),
});
const claudeMessageSchema = z.looseObject({ content: z.unknown() });

export const readText = (value: SessionStoreEntry[string]): string | undefined => {
  const parsed = claudeTextSchema.safeParse(value);
  return parsed.success && parsed.data.trim().length > 0 ? parsed.data : undefined;
};

export const readStringProp = (
  value: ClaudeStringPropertySource,
  key: string,
): string | undefined => {
  const parsed = claudeProtocolObjectSchema.safeParse(value);
  return parsed.success ? readText(parsed.data[key]) : undefined;
};

export const claudeSessionScope = (input: ClaudeSessionInput) => input.sessionScope;

const claudeWorkflowScope = (input: ClaudeSessionInput): AgentSessionWorkflowScope | null => {
  const scope = claudeSessionScope(input);
  return scope?.kind === "workflow" ? scope : null;
};

export const claudeWorkflowRole = (input: ClaudeSessionInput): AgentRole | null =>
  claudeWorkflowScope(input)?.role ?? null;

export const claudeSessionRef = (session: ClaudeSessionContext): SessionRef => ({
  repoPath: session.input.repoPath,
  runtimeKind: "claude",
  workingDirectory: session.input.workingDirectory,
  externalSessionId: session.externalSessionId,
});

export const isReadOnlyWorkflowRole = (role: AgentRole | null): boolean =>
  role !== null && role !== "build";

export const canonicalOdtToolName = (toolName: string): OdtToolName | null =>
  normalizeOdtToolName(toolName, toClaudeOdtToolAliases);

export const permissionRequestTypeForTool = (
  toolName: string,
): AgentPendingApprovalRequest["requestType"] => {
  if (/bash|shell/i.test(toolName)) {
    return "command_execution";
  }
  if (/write|edit|patch|notebook/i.test(toolName)) {
    return "file_change";
  }
  if (canonicalOdtToolName(toolName)) {
    return "runtime_tool";
  }
  return "permission_grant";
};

export const mutationForTool = (
  toolName: string,
  _input?: Parameters<CanUseTool>[1],
): NonNullable<AgentPendingApprovalRequest["mutation"]> => {
  if (/bash|shell/iu.test(toolName)) {
    return "unknown";
  }
  if (/^(Read|LS|Glob|Grep|NotebookRead|TodoRead|Skill)$/iu.test(toolName)) {
    return "read_only";
  }
  if (/write|edit|patch|notebook|todo/i.test(toolName)) {
    return "mutating";
  }
  const odtTool = canonicalOdtToolName(toolName);
  if (odtTool) {
    return isOdtMutationToolName(odtTool) ? "mutating" : "read_only";
  }
  return "unknown";
};

export const previewInput = (input: Parameters<CanUseTool>[1]): string | undefined => {
  const command = readStringProp(input, "command");
  if (command) {
    return command;
  }
  const filePath = readStringProp(input, "file_path") ?? readStringProp(input, "path");
  if (filePath) {
    return filePath;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return undefined;
  }
  return JSON.stringify(input).slice(0, 500);
};

export const toolPartType = (
  toolName: string,
): Extract<AgentStreamPart, { kind: "tool" }>["toolType"] => {
  if (canonicalOdtToolName(toolName)) {
    return "workflow";
  }
  if (/^Task(?:Create|Update|Get|List)$/u.test(toolName)) {
    return "todo";
  }
  if (/bash|shell/i.test(toolName)) {
    return "bash";
  }
  if (/read/i.test(toolName)) {
    return "read";
  }
  if (/grep|glob|search/i.test(toolName)) {
    return "search";
  }
  if (/write|edit|patch|notebook/i.test(toolName)) {
    return "file_edit";
  }
  if (/todo/i.test(toolName)) {
    return "todo";
  }
  if (
    /^(AskUserQuestion|permission_ask_user_question|ask_user_question|question|user_question)$/iu.test(
      toolName,
    )
  ) {
    return "question";
  }
  return "generic";
};

export const toolPartPresentation = (
  toolName: string,
): Pick<Extract<AgentStreamPart, { kind: "tool" }>, "toolType"> &
  Partial<Pick<Extract<AgentStreamPart, { kind: "tool" }>, "displayLabel">> => {
  const toolType = toolPartType(toolName);
  if (toolType === "todo") {
    return { toolType, displayLabel: "todo" };
  }
  return { toolType };
};

type ClaudeMessageContent =
  | Extract<SDKMessage, { type: "assistant" | "user" }>["message"]["content"]
  | SessionStoreEntry[string];

export const textFromContentBlocks = (content: ClaudeMessageContent): string => {
  const text = claudeTextSchema.safeParse(content);
  if (text.success) {
    return text.data;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      const parsed = claudeContentBlockSchema.safeParse(block);
      if (!parsed.success) {
        return "";
      }
      if (parsed.data.type === "text") {
        return parsed.data.text ?? "";
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
};

export const historyMessageText = (message: SessionStoreEntry[string]): string => {
  const parsed = claudeMessageSchema.safeParse(message);
  if (!parsed.success) {
    return "";
  }
  return textFromContentBlocks(parsed.data.content);
};

export const modelSelection = (model: string): AgentModelSelection => ({
  providerId: "claude",
  modelId: model,
  runtimeKind: "claude",
});

export const unsupported = (operation: string): never => {
  throw new HostOperationError({
    operation,
    message: `Claude Agent SDK does not expose ${operation} through a stable request API.`,
  });
};
