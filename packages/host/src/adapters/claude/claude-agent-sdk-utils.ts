import { CLAUDE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentRole,
  AgentSessionWorkflowScope,
  AgentStreamPart,
  SessionRef,
} from "@openducktor/core";
import { normalizeOdtWorkflowToolName } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkServiceError, ClaudeSessionContext } from "./claude-agent-sdk-types";

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

export const readText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readStringProp = (value: unknown, key: string): string | undefined =>
  isRecord(value) ? readText(value[key]) : undefined;

export const claudeWorkflowScope = (input: unknown): AgentSessionWorkflowScope | null => {
  if (!isRecord(input)) {
    return null;
  }
  const scope = input.sessionScope;
  return isRecord(scope) && scope.kind === "workflow" ? (scope as AgentSessionWorkflowScope) : null;
};

export const claudeWorkflowRole = (input: unknown): AgentRole | null =>
  claudeWorkflowScope(input)?.role ?? null;

export const claudeSessionRef = (session: ClaudeSessionContext): SessionRef => ({
  repoPath: session.input.repoPath,
  runtimeKind: "claude",
  workingDirectory: session.input.workingDirectory,
  externalSessionId: session.externalSessionId,
});

export const isReadOnlyWorkflowRole = (role: AgentRole | null): boolean =>
  role !== null && role !== "build";

export const canonicalOdtToolName = (toolName: string): string | null => {
  return normalizeOdtWorkflowToolName(
    toolName,
    CLAUDE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
  );
};

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

const isClaudeShellTool = (toolName: string): boolean => /bash|shell/iu.test(toolName);

export const mutationForTool = (
  toolName: string,
  _input?: Record<string, unknown>,
): NonNullable<AgentPendingApprovalRequest["mutation"]> => {
  if (isClaudeShellTool(toolName)) {
    return "mutating";
  }
  if (/^(Read|LS|Glob|Grep|NotebookRead|TodoRead|Skill)$/iu.test(toolName)) {
    return "read_only";
  }
  if (/write|edit|patch|notebook|todo/i.test(toolName)) {
    return "mutating";
  }
  const odtTool = canonicalOdtToolName(toolName);
  if (odtTool && odtTool !== "odt_read_task" && odtTool !== "odt_read_task_documents") {
    return "mutating";
  }
  if (odtTool) {
    return "read_only";
  }
  return "unknown";
};

export const previewInput = (input: Record<string, unknown>): string | undefined => {
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

export const detectFileKind = (
  path: string,
  isDirectory: boolean,
): AgentStreamPart["kind"] | "code" | "css" | "default" | "directory" | "image" | "video" => {
  if (isDirectory) {
    return "directory";
  }
  const lower = path.toLowerCase();
  if (/\.(css|scss|sass|less)$/u.test(lower)) {
    return "css";
  }
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)$/u.test(lower)) {
    return "image";
  }
  if (/\.(mp4|mov|webm|m4v)$/u.test(lower)) {
    return "video";
  }
  if (
    /\.(ts|tsx|js|jsx|json|md|go|rs|py|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sql|sh|yml|yaml|toml)$/u.test(
      lower,
    )
  ) {
    return "code";
  }
  return "default";
};

export const toolPartType = (
  toolName: string,
): Extract<AgentStreamPart, { kind: "tool" }>["toolType"] => {
  if (canonicalOdtToolName(toolName)) {
    return "workflow";
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

export const textFromContentBlocks = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!isRecord(block)) {
        return "";
      }
      const type = readStringProp(block, "type");
      if (type === "text") {
        return readStringProp(block, "text") ?? "";
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
};

export const claudeAssistantTextPartEvent = ({
  externalSessionId,
  messageId,
  partId,
  text,
  timestamp,
}: {
  externalSessionId: string;
  messageId: string;
  partId?: string;
  text: string;
  timestamp: string;
}): AgentEvent => ({
  type: "assistant_part",
  externalSessionId,
  timestamp,
  part: {
    kind: "text",
    messageId,
    partId: partId ?? `${messageId}:text`,
    text,
    completed: true,
  },
});

export const historyMessageText = (message: unknown): string => {
  if (!isRecord(message)) {
    return "";
  }
  return textFromContentBlocks(message.content);
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

export const claudeSessionRoute = (runtimeId: string): RuntimeInstanceSummary["runtimeRoute"] => ({
  type: "stdio",
  identity: runtimeId,
});
