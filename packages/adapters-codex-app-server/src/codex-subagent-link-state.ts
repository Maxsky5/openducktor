import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";

export type CodexSubagentRoute = {
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey: string;
};

export type CodexSubagentLinkInput = {
  parentThreadId: string;
  childThreadId?: string;
  itemId: string;
  status: AgentSubagentStatus;
  prompt?: string;
  description?: string;
  error?: string;
  agent?: string;
  metadata?: Record<string, unknown>;
  executionMode?: "background";
};

type CodexStoredSubagentLink = {
  parentThreadId: string;
  childThreadId?: string;
  correlationKey: string;
  status: AgentSubagentStatus;
  prompt?: string;
  description?: string;
  error?: string;
  agent?: string;
  metadata?: Record<string, unknown>;
  executionMode?: "background";
};

const subagentKey = (parentThreadId: string, childThreadId: string): string =>
  `${parentThreadId}\u0000${childThreadId}`;

const linkedCorrelationKey = (parentThreadId: string, childThreadId: string): string =>
  `codex-subagent:${parentThreadId}:${childThreadId}`;

const provisionalCorrelationKey = (parentThreadId: string, itemId: string): string =>
  `codex-subagent:${parentThreadId}:${itemId}`;

const STATUS_PRECEDENCE: Record<AgentSubagentStatus, number> = {
  pending: 0,
  running: 1,
  cancelled: 2,
  error: 3,
  completed: 4,
};

const resolveStatus = (
  existing: AgentSubagentStatus | undefined,
  incoming: AgentSubagentStatus,
): AgentSubagentStatus => {
  if (!existing) {
    return incoming;
  }
  return STATUS_PRECEDENCE[incoming] > STATUS_PRECEDENCE[existing] ? incoming : existing;
};

const preferredAgentLabel = (thread: CodexThreadSnapshot): string | undefined =>
  thread.agentNickname ??
  thread.agentRole ??
  thread.subAgentSource?.agentNickname ??
  thread.subAgentSource?.agentRole ??
  undefined;

const mergeDefined = <T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: T | undefined,
): T | undefined => {
  if (existing && incoming) {
    return { ...existing, ...incoming };
  }
  return incoming ?? existing;
};

export class CodexSubagentLinkState {
  private readonly linksByParentChildKey = new Map<string, CodexStoredSubagentLink>();
  private readonly linksByChildThreadId = new Map<string, CodexStoredSubagentLink>();
  private readonly linksByCorrelationKey = new Map<string, CodexStoredSubagentLink>();
  private readonly provisionalByParentItemKey = new Map<string, CodexStoredSubagentLink>();

  recordThread(thread: CodexThreadSnapshot): void {
    const parentThreadId = thread.parentThreadId ?? thread.subAgentSource?.parentThreadId;
    if (!parentThreadId || parentThreadId === thread.id) {
      return;
    }
    const agent = preferredAgentLabel(thread);
    this.upsertLink({
      parentThreadId,
      childThreadId: thread.id,
      itemId: thread.id,
      status:
        thread.status.classification === "running"
          ? "running"
          : thread.status.classification === "idle"
            ? "completed"
            : "running",
      ...(agent ? { agent } : {}),
      metadata: {
        codexThread: {
          parentThreadId,
          childThreadId: thread.id,
          ...(thread.agentNickname ? { agentNickname: thread.agentNickname } : {}),
          ...(thread.agentRole ? { agentRole: thread.agentRole } : {}),
          ...(thread.subAgentSource ? { subAgentSource: thread.subAgentSource } : {}),
        },
      },
      executionMode: "background",
    });
  }

  upsertLink(input: CodexSubagentLinkInput): AgentStreamPart {
    const parentItemKey = subagentKey(input.parentThreadId, input.itemId);
    const existingProvisional = this.provisionalByParentItemKey.get(parentItemKey);
    const parentChildKey = input.childThreadId
      ? subagentKey(input.parentThreadId, input.childThreadId)
      : null;
    const existingLinked =
      input.childThreadId && parentChildKey
        ? (this.linksByParentChildKey.get(parentChildKey) ??
          this.linksByChildThreadId.get(input.childThreadId))
        : undefined;
    const correlationKey =
      existingLinked?.correlationKey ??
      existingProvisional?.correlationKey ??
      (input.childThreadId
        ? linkedCorrelationKey(input.parentThreadId, input.childThreadId)
        : provisionalCorrelationKey(input.parentThreadId, input.itemId));
    const existing =
      existingLinked ?? existingProvisional ?? this.linksByCorrelationKey.get(correlationKey);
    const status = resolveStatus(existing?.status, input.status);
    const childThreadId = input.childThreadId ?? existing?.childThreadId;
    const prompt = input.prompt ?? existing?.prompt;
    const description = input.description ?? existing?.description;
    const error = input.error ?? existing?.error;
    const agent = input.agent ?? existing?.agent;
    const metadata = mergeDefined(existing?.metadata, input.metadata);
    const executionMode = input.executionMode ?? existing?.executionMode;
    const link: CodexStoredSubagentLink = {
      parentThreadId: input.parentThreadId,
      ...(childThreadId ? { childThreadId } : {}),
      correlationKey,
      status,
      ...(prompt ? { prompt } : {}),
      ...(description ? { description } : {}),
      ...(error ? { error } : {}),
      ...(agent ? { agent } : {}),
      ...(metadata ? { metadata } : {}),
      ...(executionMode ? { executionMode } : {}),
    };
    this.storeLink(link, parentItemKey);
    return this.toPart(link);
  }

  routeForChild(childThreadId: string): CodexSubagentRoute | null {
    const link = this.linksByChildThreadId.get(childThreadId);
    if (!link?.childThreadId) {
      return null;
    }
    return {
      parentExternalSessionId: link.parentThreadId,
      childExternalSessionId: link.childThreadId,
      subagentCorrelationKey: link.correlationKey,
    };
  }

  private storeLink(link: CodexStoredSubagentLink, parentItemKey: string): void {
    const hadProvisionalBridge = this.provisionalByParentItemKey.has(parentItemKey);
    this.linksByCorrelationKey.set(link.correlationKey, link);
    if (!link.childThreadId || hadProvisionalBridge) {
      this.provisionalByParentItemKey.set(parentItemKey, link);
    }
    if (!link.childThreadId) {
      return;
    }
    this.linksByParentChildKey.set(subagentKey(link.parentThreadId, link.childThreadId), link);
    this.linksByChildThreadId.set(link.childThreadId, link);
  }

  private toPart(link: CodexStoredSubagentLink): AgentStreamPart {
    return {
      kind: "subagent",
      messageId: link.correlationKey,
      partId: link.correlationKey,
      correlationKey: link.correlationKey,
      status: link.status,
      ...(link.agent ? { agent: link.agent } : {}),
      ...(link.prompt ? { prompt: link.prompt } : {}),
      ...(link.description ? { description: link.description } : {}),
      ...(link.error ? { error: link.error } : {}),
      ...(link.childThreadId ? { externalSessionId: link.childThreadId } : {}),
      ...(link.executionMode ? { executionMode: link.executionMode } : {}),
      ...(link.metadata ? { metadata: link.metadata } : {}),
    };
  }
}
