import type {
  CodexAppServerCollabAgentState,
  CodexAppServerCollabAgentTool,
  CodexAppServerCollabAgentToolCallStatus,
  CodexAppServerJsonValue,
} from "@openducktor/contracts";
import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";
import type { CodexMappingContext } from "./codex-canonical-events";
import type { CodexTimedThreadItem } from "./codex-event-mapper";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { codexToolTimingFields } from "./codex-tool-timing";

type CodexCollabItem = Extract<CodexTimedThreadItem, { type: "collabAgentToolCall" }>;
type CodexSubagentActivityItem = Extract<CodexTimedThreadItem, { type: "subAgentActivity" }>;
type CodexSubagentItem = CodexCollabItem | CodexSubagentActivityItem;

type StatusMapping = {
  status: AgentSubagentStatus;
  error?: string;
};

interface CodexSubagentMetadata {
  [key: string]: CodexAppServerJsonValue;
}

class CodexSubagentItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexSubagentItemError";
  }
}

const itemError = (
  item: CodexSubagentItem,
  message: string,
  context: Record<string, CodexAppServerJsonValue | undefined> = {},
): CodexSubagentItemError =>
  new CodexSubagentItemError(
    `Malformed Codex subagent item '${item.id}' of type '${item.type}': ${message}. Context: ${JSON.stringify(
      context,
    )}`,
  );

const assertNever = (value: never): never => value;

const mapAgentStatus = (
  state: CodexAppServerCollabAgentState,
  childThreadId: string,
): StatusMapping => {
  const error = state.message?.trim() || undefined;
  switch (state.status) {
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
        error: error ?? `Codex subagent '${childThreadId}' status is ${state.status}.`,
      };
    default:
      return assertNever(state.status);
  }
};

const mapAggregateStatus = (
  status: CodexAppServerCollabAgentToolCallStatus,
  tool: CodexAppServerCollabAgentTool,
): StatusMapping => {
  if (status === "inProgress") {
    return { status: "running" };
  }
  if (status === "failed") {
    return { status: "error", error: `Codex ${tool} subagent call failed.` };
  }
  return { status: tool === "closeAgent" ? "cancelled" : "completed" };
};

const statusForChild = (item: CodexCollabItem, childThreadId: string): StatusMapping => {
  const state = item.agentsStates[childThreadId];
  if (state) {
    return mapAgentStatus(state, childThreadId);
  }
  if (item.tool === "closeAgent" && item.status === "completed") {
    return { status: "cancelled" };
  }
  if (item.status === "failed") {
    return mapAggregateStatus(item.status, item.tool);
  }
  if (item.tool === "wait" && item.status !== "inProgress") {
    throw itemError(item, "missing collab agent state", {
      aggregateStatus: item.status,
      childThreadId,
      tool: item.tool,
    });
  }
  return { status: "running" };
};

const SUBAGENT_DESCRIPTION_MAX_LENGTH = 140;

const creationDescriptionForPrompt = (
  tool: CodexAppServerCollabAgentTool,
  prompt: string | null,
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
  item: CodexCollabItem,
  parentThreadId: string,
  childThreadId?: string,
): CodexSubagentMetadata => ({
  codexSubagent: {
    source: item.type,
    itemId: item.id,
    tool: item.tool,
    parentThreadId,
    ...(childThreadId ? { childThreadId } : undefined),
  },
});

const activityMetadata = (
  item: CodexSubagentActivityItem,
  parentThreadId: string,
): CodexSubagentMetadata => ({
  codexSubagent: {
    source: item.type,
    itemId: item.id,
    kind: item.kind,
    parentThreadId,
    childThreadId: item.agentThreadId,
    agentPath: item.agentPath,
  },
});

const collabAgentParts = (
  item: CodexCollabItem,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
): AgentStreamPart[] => {
  const creationDescription = creationDescriptionForPrompt(item.tool, item.prompt);
  if (item.receiverThreadIds.length === 0) {
    if (item.tool !== "spawnAgent") {
      throw itemError(item, "missing receiverThreadIds for linked collab tool", {
        tool: item.tool,
        parentThreadId: item.senderThreadId,
      });
    }
    const mapped = mapAggregateStatus(item.status, item.tool);
    return [
      linkState.upsertLink({
        ...(ctx.runtimeId ? { runtimeId: ctx.runtimeId } : undefined),
        parentThreadId: item.senderThreadId,
        itemId: item.id,
        status: mapped.status,
        ...(item.prompt ? { prompt: item.prompt } : undefined),
        ...(creationDescription ? { description: creationDescription } : undefined),
        ...(mapped.error ? { error: mapped.error } : undefined),
        metadata: collabMetadata(item, item.senderThreadId),
      }),
    ];
  }

  return [...new Set(item.receiverThreadIds)].map((childThreadId) => {
    const mapped = statusForChild(item, childThreadId);
    return linkState.upsertLink({
      ...(ctx.runtimeId ? { runtimeId: ctx.runtimeId } : undefined),
      parentThreadId: item.senderThreadId,
      childThreadId,
      itemId: item.id,
      status: mapped.status,
      ...(item.prompt ? { prompt: item.prompt } : undefined),
      ...(creationDescription ? { description: creationDescription } : undefined),
      ...(mapped.error ? { error: mapped.error } : undefined),
      metadata: collabMetadata(item, item.senderThreadId, childThreadId),
      preferItemCorrelationKey: item.tool === "spawnAgent",
      allowStatusRestart: item.tool === "resumeAgent" && mapped.status === "running",
      ...codexToolTimingFields(item, { allowStartedAtOnly: mapped.status === "running" }),
    });
  });
};

const subagentActivityParts = (
  item: CodexSubagentActivityItem,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
): AgentStreamPart[] => {
  const sourceThreadId = ctx.threadId;
  if (sourceThreadId === item.agentThreadId) {
    throw itemError(item, "subAgentActivity parent thread matches child thread", {
      parentThreadId: sourceThreadId,
      childThreadId: item.agentThreadId,
    });
  }
  const route = linkState.routeForChild(item.agentThreadId, ctx.runtimeId);
  if (!route && item.kind !== "started") {
    return [];
  }
  const runtimeId = route?.runtimeId ?? ctx.runtimeId;
  return [
    linkState.upsertLink({
      ...(runtimeId ? { runtimeId } : undefined),
      parentThreadId: sourceThreadId,
      childThreadId: item.agentThreadId,
      itemId: item.id,
      status: "running",
      metadata: activityMetadata(item, sourceThreadId),
    }),
  ];
};

export const codexSubagentPartsFromItem = (
  item: CodexSubagentItem,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
): AgentStreamPart[] =>
  item.type === "collabAgentToolCall"
    ? collabAgentParts(item, ctx, linkState)
    : subagentActivityParts(item, ctx, linkState);
