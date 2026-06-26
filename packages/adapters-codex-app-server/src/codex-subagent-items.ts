import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";
import type { CodexMappingContext } from "./codex-canonical-events";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";

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
  description?: string;
  error?: string;
};

export class CodexSubagentItemError extends Error {
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

const receiverThreadIds = (item: Record<string, unknown>): string[] =>
  arrayFromUnknown(item.receiverThreadIds ?? item.receiver_thread_ids).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );

const agentsStates = (item: Record<string, unknown>): Record<string, unknown> => {
  const states = item.agentsStates ?? item.agents_states;
  return isPlainObject(states) ? states : {};
};

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
  switch (status as CodexCollabAgentStatus) {
    case "pendingInit":
      return text ? { status: "pending", description: text } : { status: "pending" };
    case "running":
      return text ? { status: "running", description: text } : { status: "running" };
    case "completed":
      return text ? { status: "completed", description: text } : { status: "completed" };
    case "interrupted":
    case "shutdown":
      return text ? { status: "cancelled", description: text } : { status: "cancelled" };
    case "errored":
    case "notFound":
      return {
        status: "error",
        error: text ?? `Codex subagent '${childThreadId}' status is ${status}.`,
      };
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
  const state = agentsStates(item)[childThreadId];
  if (!isPlainObject(state)) {
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

const mapActivityStatus = (kind: CodexSubagentActivityKind): StatusMapping => {
  if (kind === "interrupted") {
    return { status: "cancelled", description: "Subagent interrupted." };
  }
  if (kind === "started") {
    return { status: "running", description: "Subagent started." };
  }
  return { status: "running", description: "Subagent activity updated." };
};

const collabMetadata = (
  item: Record<string, unknown>,
  parentThreadId: string,
  childThreadId?: string,
): Record<string, unknown> => ({
  codexSubagent: {
    source: "collabAgentToolCall",
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
): Record<string, unknown> => ({
  codexSubagent: {
    source: "subAgentActivity",
    itemId: extractStringField(item, ["id"]),
    kind: extractStringField(item, ["kind"]),
    parentThreadId,
    childThreadId,
    ...(extractStringField(item, ["agentPath", "agent_path"])
      ? { agentPath: extractStringField(item, ["agentPath", "agent_path"]) }
      : {}),
  },
});

export const codexSubagentPartsFromItem = (
  item: Record<string, unknown>,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
): AgentStreamPart[] => {
  const type = extractStringField(item, ["type"]);
  if (type === "collabAgentToolCall") {
    const itemId = requireStringField(item, ["id"], "id");
    const tool = collabTool(item);
    const aggregateStatus = collabCallStatus(item);
    const parentThreadId = requireStringField(
      item,
      ["senderThreadId", "sender_thread_id"],
      "senderThreadId",
    );
    const prompt = extractStringField(item, ["prompt"]) ?? undefined;
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
          parentThreadId,
          itemId,
          status: mapped.status,
          ...(prompt ? { prompt } : {}),
          ...(mapped.description ? { description: mapped.description } : {}),
          ...(mapped.error ? { error: mapped.error } : {}),
          metadata: collabMetadata(item, parentThreadId),
          executionMode: "background",
        }),
      ];
    }
    return receivers.map((childThreadId) => {
      const mapped = statusForChild(item, tool, aggregateStatus, childThreadId);
      return linkState.upsertLink({
        parentThreadId,
        childThreadId,
        itemId,
        status: mapped.status,
        ...(prompt ? { prompt } : {}),
        ...(mapped.description ? { description: mapped.description } : {}),
        ...(mapped.error ? { error: mapped.error } : {}),
        metadata: collabMetadata(item, parentThreadId, childThreadId),
        executionMode: "background",
        preferItemCorrelationKey: tool === "spawnAgent",
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
    const parentThreadId = ctx.threadId;
    if (parentThreadId === childThreadId) {
      throw itemError(item, "subAgentActivity parent thread matches child thread", {
        parentThreadId,
        childThreadId,
      });
    }
    const mapped = mapActivityStatus(activityKind(item));
    return [
      linkState.upsertLink({
        parentThreadId,
        childThreadId,
        itemId,
        status: mapped.status,
        ...(mapped.description ? { description: mapped.description } : {}),
        ...(mapped.error ? { error: mapped.error } : {}),
        metadata: activityMetadata(item, parentThreadId, childThreadId),
        executionMode: "background",
      }),
    ];
  }

  return [];
};
