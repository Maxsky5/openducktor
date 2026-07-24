import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";
import type { CodexMappingContext } from "./codex-canonical-events";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { codexToolTimingFields } from "./codex-tool-timing";

type CodexCollabTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent";
type CodexCollabCallStatus = "inProgress" | "completed" | "failed";
type CodexCollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";
type CodexSubagentActivityKind = "started" | "interacted" | "interrupted";

type StatusMapping = {
  status: AgentSubagentStatus;
  error?: string;
};

type CodexCollabItemType = "collabAgentToolCall" | "collabToolCall";

class CodexSubagentItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexSubagentItemError";
  }
}

const COLLAB_TOOLS = new Set<CodexCollabTool>([
  "spawnAgent",
  "sendInput",
  "resumeAgent",
  "wait",
  "closeAgent",
]);

const COLLAB_CALL_STATUSES = new Set<CodexCollabCallStatus>(["inProgress", "completed", "failed"]);

const COLLAB_AGENT_STATUSES = new Set<CodexCollabAgentStatus>([
  "pendingInit",
  "running",
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound",
]);

const ACTIVITY_KINDS = new Set<CodexSubagentActivityKind>(["started", "interacted", "interrupted"]);

const itemError = (
  item: Record<string, unknown>,
  message: string,
  context: Record<string, unknown> = {},
): CodexSubagentItemError => {
  const id = extractStringField(item, ["id"]) ?? "<missing>";
  const type = extractStringField(item, ["type"]) ?? "<missing>";
  return new CodexSubagentItemError(
    `Malformed Codex subagent item '${id}' of type '${type}': ${message}. Context: ${JSON.stringify(
      context,
    )}`,
  );
};

const requireStringField = (
  item: Record<string, unknown>,
  keys: string[],
  label: string,
): string => {
  const value = extractStringField(item, keys);
  if (!value) {
    throw itemError(item, `missing ${label}`);
  }
  return value;
};

const collabTool = (item: Record<string, unknown>): CodexCollabTool => {
  const tool = requireStringField(item, ["tool"], "tool");
  if (!COLLAB_TOOLS.has(tool as CodexCollabTool)) {
    throw itemError(item, "unknown collab tool", { tool });
  }
  return tool as CodexCollabTool;
};

const collabCallStatus = (item: Record<string, unknown>): CodexCollabCallStatus => {
  const status = requireStringField(item, ["status"], "status");
  if (!COLLAB_CALL_STATUSES.has(status as CodexCollabCallStatus)) {
    throw itemError(item, "unknown collab tool-call status", { status });
  }
  return status as CodexCollabCallStatus;
};

const stringArrayField = (value: unknown): string[] =>
  arrayFromUnknown(value).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );

const receiverThreadIds = (item: Record<string, unknown>): string[] => {
  const receivers = [
    ...stringArrayField(item.receiverThreadIds ?? item.receiver_thread_ids),
    extractStringField(item, ["receiverThreadId", "receiver_thread_id"]),
    extractStringField(item, ["newThreadId", "new_thread_id"]),
  ].filter((entry): entry is string => Boolean(entry));
  return [...new Set(receivers)];
};

const agentsStates = (item: Record<string, unknown>): Record<string, unknown> => {
  const states = item.agentsStates ?? item.agents_states;
  return isPlainObject(states) ? states : {};
};

const agentStateForChild = (
  item: Record<string, unknown>,
  childThreadId: string,
): Record<string, unknown> | null => {
  const state = agentsStates(item)[childThreadId];
  if (isPlainObject(state)) {
    return state;
  }
  const status = extractStringField(item, ["agentStatus", "agent_status"]);
  if (!status) {
    return null;
  }
  return {
    status,
    message: extractStringField(item, ["agentMessage", "agent_message"]),
  };
};

const assertNever = (value: never): never => value;

const mapAgentStatus = (
  item: Record<string, unknown>,
  status: unknown,
  message: unknown,
  childThreadId: string,
): StatusMapping => {
  if (typeof status !== "string" || !COLLAB_AGENT_STATUSES.has(status as CodexCollabAgentStatus)) {
    throw itemError(item, "unknown collab agent status", { status, childThreadId });
  }
  const text = typeof message === "string" && message.trim().length > 0 ? message : undefined;
  const agentStatus = status as CodexCollabAgentStatus;
  switch (agentStatus) {
    case "pendingInit":
      return { status: "pending" };
    case "running":
      return { status: "running" };
    case "completed":
      return { status: "completed" };
    case "interrupted":
      return { status: "running" };
    case "shutdown":
      return { status: "cancelled" };
    case "errored":
    case "notFound":
      return {
        status: "error",
        error: text ?? `Codex subagent '${childThreadId}' status is ${agentStatus}.`,
      };
    default:
      return assertNever(agentStatus);
  }
};

const mapAggregateStatus = (
  status: CodexCollabCallStatus,
  tool: CodexCollabTool,
): StatusMapping => {
  if (status === "inProgress") {
    return { status: "running" };
  }
  if (status === "failed") {
    return { status: "error", error: `Codex ${tool} subagent call failed.` };
  }
  if (tool === "closeAgent") {
    return { status: "cancelled" };
  }
  return { status: "completed" };
};

const statusForChild = (
  item: Record<string, unknown>,
  tool: CodexCollabTool,
  aggregateStatus: CodexCollabCallStatus,
  childThreadId: string,
): StatusMapping => {
  const state = agentStateForChild(item, childThreadId);
  if (!state) {
    if (tool === "closeAgent" && aggregateStatus === "completed") {
      return { status: "cancelled" };
    }
    if (aggregateStatus === "failed") {
      return mapAggregateStatus(aggregateStatus, tool);
    }
    if (tool === "wait" && aggregateStatus !== "inProgress") {
      throw itemError(item, "missing collab agent state", {
        aggregateStatus,
        childThreadId,
        tool,
      });
    }
    return { status: "running" };
  }
  return mapAgentStatus(item, state.status, state.message, childThreadId);
};

const activityKind = (item: Record<string, unknown>): CodexSubagentActivityKind => {
  const kind = requireStringField(item, ["kind"], "kind");
  if (!ACTIVITY_KINDS.has(kind as CodexSubagentActivityKind)) {
    throw itemError(item, "unknown subagent activity kind", { kind });
  }
  return kind as CodexSubagentActivityKind;
};

const SUBAGENT_DESCRIPTION_MAX_LENGTH = 140;

const creationDescriptionForPrompt = (
  tool: CodexCollabTool,
  prompt: string | undefined,
): string | undefined => {
  if (tool !== "spawnAgent") {
    return undefined;
  }
  const text = prompt?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= SUBAGENT_DESCRIPTION_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, SUBAGENT_DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
};

const collabMetadata = (
  item: Record<string, unknown>,
  source: CodexCollabItemType,
  parentThreadId: string,
  childThreadId?: string,
): Record<string, unknown> => ({
  codexSubagent: {
    source,
    itemId: extractStringField(item, ["id"]),
    tool: extractStringField(item, ["tool"]),
    parentThreadId,
    ...(childThreadId ? { childThreadId } : {}),
  },
});

const activityMetadata = (
  item: Record<string, unknown>,
  parentThreadId: string,
  childThreadId: string,
): Record<string, unknown> => {
  const agentPath = extractStringField(item, ["agentPath", "agent_path"]);
  return {
    codexSubagent: {
      source: "subAgentActivity",
      itemId: extractStringField(item, ["id"]),
      kind: extractStringField(item, ["kind"]),
      parentThreadId,
      childThreadId,
      ...(agentPath ? { agentPath } : {}),
    },
  };
};

export const codexSubagentPartsFromItem = (
  item: Record<string, unknown>,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
): AgentStreamPart[] => {
  const type = extractStringField(item, ["type"]);
  if (type === "collabAgentToolCall" || type === "collabToolCall") {
    const itemId = requireStringField(item, ["id"], "id");
    const tool = collabTool(item);
    const aggregateStatus = collabCallStatus(item);
    const parentThreadId = requireStringField(
      item,
      ["senderThreadId", "sender_thread_id"],
      "senderThreadId",
    );
    const prompt = extractStringField(item, ["prompt"]) ?? undefined;
    const creationDescription = creationDescriptionForPrompt(tool, prompt);
    const receivers = receiverThreadIds(item);
    if (receivers.length === 0) {
      if (tool !== "spawnAgent") {
        throw itemError(item, "missing receiverThreadIds for linked collab tool", {
          tool,
          parentThreadId,
        });
      }
      const mapped = mapAggregateStatus(aggregateStatus, tool);
      return [
        linkState.upsertLink({
          ...(ctx.runtimeId ? { runtimeId: ctx.runtimeId } : {}),
          parentThreadId,
          itemId,
          status: mapped.status,
          ...(prompt ? { prompt } : {}),
          ...(creationDescription ? { description: creationDescription } : {}),
          ...(mapped.error ? { error: mapped.error } : {}),
          metadata: collabMetadata(item, type, parentThreadId),
        }),
      ];
    }
    return receivers.map((childThreadId) => {
      const mapped = statusForChild(item, tool, aggregateStatus, childThreadId);
      return linkState.upsertLink({
        ...(ctx.runtimeId ? { runtimeId: ctx.runtimeId } : {}),
        parentThreadId,
        childThreadId,
        itemId,
        status: mapped.status,
        ...(prompt ? { prompt } : {}),
        ...(creationDescription ? { description: creationDescription } : {}),
        ...(mapped.error ? { error: mapped.error } : {}),
        metadata: collabMetadata(item, type, parentThreadId, childThreadId),
        preferItemCorrelationKey: tool === "spawnAgent",
        allowStatusRestart: tool === "resumeAgent" && mapped.status === "running",
        ...codexToolTimingFields(item, { allowStartedAtOnly: mapped.status === "running" }),
      });
    });
  }

  if (type === "subAgentActivity") {
    const itemId = requireStringField(item, ["id"], "id");
    const childThreadId = requireStringField(
      item,
      ["agentThreadId", "agent_thread_id"],
      "agentThreadId",
    );
    const sourceThreadId = ctx.threadId;
    const kind = activityKind(item);
    const route = linkState.routeForChild(childThreadId, ctx.runtimeId);
    if (sourceThreadId === childThreadId) {
      throw itemError(item, "subAgentActivity parent thread matches child thread", {
        parentThreadId: sourceThreadId,
        childThreadId,
      });
    }
    if (!route && kind !== "started") {
      return [];
    }
    const runtimeId = route?.runtimeId ?? ctx.runtimeId;
    return [
      linkState.upsertLink({
        ...(runtimeId ? { runtimeId } : {}),
        parentThreadId: sourceThreadId,
        childThreadId,
        itemId,
        status: "running",
        metadata: activityMetadata(item, sourceThreadId, childThreadId),
      }),
    ];
  }

  return [];
};
