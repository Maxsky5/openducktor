import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";

type CodexSubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;

export type CodexSubagentRoute = {
  runtimeId?: string;
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey: string;
};

export const codexSubagentRouteEventFields = (route: CodexSubagentRoute | null | undefined) =>
  route
    ? {
        parentExternalSessionId: route.parentExternalSessionId,
        childExternalSessionId: route.childExternalSessionId,
        subagentCorrelationKey: route.subagentCorrelationKey,
      }
    : {};

export type CodexSubagentLinkInput = {
  runtimeId?: string;
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
  preferItemCorrelationKey?: boolean;
  allowStatusRestart?: boolean;
  startedAtMs?: number;
  endedAtMs?: number;
};

type CodexStoredSubagentLink = {
  runtimeId?: string;
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
  startedAtMs?: number;
  endedAtMs?: number;
};

type CodexSubagentRouteListener = (route: CodexSubagentRoute) => void;

const scopedKey = (runtimeId: string | undefined, ...parts: string[]): string =>
  [runtimeId ?? "", ...parts].join("\u0000");

const subagentKey = (
  runtimeId: string | undefined,
  parentThreadId: string,
  childThreadId: string,
): string => scopedKey(runtimeId, parentThreadId, childThreadId);

const childThreadKey = (runtimeId: string | undefined, childThreadId: string): string =>
  scopedKey(runtimeId, childThreadId);

const linkedCorrelationKey = (parentThreadId: string, childThreadId: string): string =>
  `codex-subagent:${parentThreadId}:${childThreadId}`;

const provisionalCorrelationKey = (parentThreadId: string, itemId: string): string =>
  `codex-subagent:${parentThreadId}:${itemId}`;

const STATUS_PRECEDENCE: Record<AgentSubagentStatus, number> = {
  pending: 0,
  running: 1,
  cancelled: 2,
  completed: 3,
  error: 4,
};

const isTerminalStatus = (status: AgentSubagentStatus): boolean =>
  status === "completed" || status === "cancelled" || status === "error";

const isPreviousRunTerminalUpdate = (
  existing: CodexStoredSubagentLink | undefined,
  input: CodexSubagentLinkInput,
): boolean =>
  existing?.status === "running" &&
  isTerminalStatus(input.status) &&
  typeof existing.startedAtMs === "number" &&
  typeof input.endedAtMs === "number" &&
  input.endedAtMs < existing.startedAtMs;

const resolveStatus = (
  existing: CodexStoredSubagentLink | undefined,
  input: CodexSubagentLinkInput,
): AgentSubagentStatus => {
  if (!existing) {
    return input.status;
  }
  if (input.allowStatusRestart === true && input.status === "running") {
    return "running";
  }
  if (isPreviousRunTerminalUpdate(existing, input)) {
    return "running";
  }
  return STATUS_PRECEDENCE[input.status] > STATUS_PRECEDENCE[existing.status]
    ? input.status
    : existing.status;
};

const preferredAgentLabel = (thread: CodexThreadSnapshot): string | undefined =>
  thread.agentNickname ??
  thread.agentRole ??
  thread.subAgentSource?.agentNickname ??
  thread.subAgentSource?.agentRole ??
  undefined;

class CodexSubagentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexSubagentLinkError";
  }
}

const mergeDefined = <T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: T | undefined,
): T | undefined => {
  if (existing && incoming) {
    return { ...existing, ...incoming };
  }
  return incoming ?? existing;
};

const routeFromLink = (link: CodexStoredSubagentLink): CodexSubagentRoute | null =>
  link.childThreadId
    ? {
        ...(link.runtimeId ? { runtimeId: link.runtimeId } : {}),
        parentExternalSessionId: link.parentThreadId,
        childExternalSessionId: link.childThreadId,
        subagentCorrelationKey: link.correlationKey,
      }
    : null;

const sameRoute = (previous: CodexSubagentRoute | null, next: CodexSubagentRoute | null): boolean =>
  previous?.runtimeId === next?.runtimeId &&
  previous?.parentExternalSessionId === next?.parentExternalSessionId &&
  previous?.childExternalSessionId === next?.childExternalSessionId &&
  previous?.subagentCorrelationKey === next?.subagentCorrelationKey;

export class CodexSubagentLinkState {
  private readonly linksByParentChildKey = new Map<string, CodexStoredSubagentLink>();
  private readonly linksByChildThreadId = new Map<string, CodexStoredSubagentLink>();
  private readonly linksByCorrelationKey = new Map<string, CodexStoredSubagentLink>();
  private readonly provisionalByParentItemKey = new Map<string, CodexStoredSubagentLink>();
  private readonly routeListeners = new Set<CodexSubagentRouteListener>();

  onRouteLearned(listener: CodexSubagentRouteListener): () => void {
    this.routeListeners.add(listener);
    return () => {
      this.routeListeners.delete(listener);
    };
  }

  recordThread(thread: CodexThreadSnapshot, runtimeId?: string): void {
    const parentThreadIds = [thread.parentThreadId, thread.subAgentSource?.parentThreadId].filter(
      (parentThreadId): parentThreadId is string => Boolean(parentThreadId),
    );
    const uniqueParentThreadIds = new Set(parentThreadIds);
    if (uniqueParentThreadIds.size > 1) {
      throw new CodexSubagentLinkError(
        `Codex child thread '${thread.id}' has conflicting parent metadata: ${parentThreadIds.join(
          ", ",
        )}.`,
      );
    }
    const parentThreadId = parentThreadIds[0];
    if (!parentThreadId || parentThreadId === thread.id) {
      return;
    }
    const agent = preferredAgentLabel(thread);
    const existing = this.linkForChild(thread.id, runtimeId);
    this.upsertLink({
      ...(runtimeId ? { runtimeId } : {}),
      parentThreadId,
      childThreadId: thread.id,
      itemId: thread.id,
      status:
        thread.status.classification === "running"
          ? "running"
          : thread.status.classification === "idle"
            ? existing?.status === "cancelled"
              ? "cancelled"
              : "completed"
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
    });
  }

  upsertLink(input: CodexSubagentLinkInput): CodexSubagentPart {
    const previousRoute = input.childThreadId
      ? this.routeForChild(input.childThreadId, input.runtimeId)
      : null;
    const parentItemKey = subagentKey(input.runtimeId, input.parentThreadId, input.itemId);
    const existingProvisional = this.provisionalByParentItemKey.get(parentItemKey);
    const parentChildKey = input.childThreadId
      ? subagentKey(input.runtimeId, input.parentThreadId, input.childThreadId)
      : null;
    const existingByChildThreadId = input.childThreadId
      ? this.linksByChildThreadId.get(childThreadKey(input.runtimeId, input.childThreadId))
      : undefined;
    if (
      input.childThreadId &&
      existingByChildThreadId &&
      existingByChildThreadId.parentThreadId !== input.parentThreadId
    ) {
      throw new CodexSubagentLinkError(
        `Codex child thread '${input.childThreadId}' is already linked to parent '${existingByChildThreadId.parentThreadId}', not '${input.parentThreadId}'.`,
      );
    }
    const existingLinked =
      input.childThreadId && parentChildKey
        ? (this.linksByParentChildKey.get(parentChildKey) ?? existingByChildThreadId)
        : undefined;
    const correlationKey =
      existingLinked?.correlationKey ??
      existingProvisional?.correlationKey ??
      (input.childThreadId
        ? input.preferItemCorrelationKey
          ? provisionalCorrelationKey(input.parentThreadId, input.itemId)
          : linkedCorrelationKey(input.parentThreadId, input.childThreadId)
        : provisionalCorrelationKey(input.parentThreadId, input.itemId));
    const existing =
      existingLinked ??
      existingProvisional ??
      this.linksByCorrelationKey.get(scopedKey(input.runtimeId, correlationKey));
    const isExplicitRunningTransition =
      input.allowStatusRestart === true && input.status === "running";
    const isPreviousRunUpdate = isPreviousRunTerminalUpdate(existing, input);
    const status = resolveStatus(existing, input);
    const childThreadId = input.childThreadId ?? existing?.childThreadId;
    const prompt = input.prompt ?? existing?.prompt;
    const description = input.description ?? existing?.description;
    let error: string | undefined;
    if (isExplicitRunningTransition) {
      error = input.error;
    } else if (isPreviousRunUpdate) {
      error = existing?.error;
    } else {
      error = input.error ?? existing?.error;
    }
    const agent = input.agent ?? existing?.agent;
    const metadata = mergeDefined(existing?.metadata, input.metadata);
    const executionMode = input.executionMode ?? existing?.executionMode;
    const startedAtMs = isPreviousRunUpdate
      ? existing?.startedAtMs
      : (input.startedAtMs ?? existing?.startedAtMs);
    const endedAtMs =
      isExplicitRunningTransition || isPreviousRunUpdate
        ? undefined
        : (input.endedAtMs ?? existing?.endedAtMs);
    const link: CodexStoredSubagentLink = {
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
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
      ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
      ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
    };
    this.storeLink(link, parentItemKey);
    const route = routeFromLink(link);
    if (route && !sameRoute(previousRoute, route)) {
      this.emitRouteLearned(route);
    }
    return this.toPart(link);
  }

  routeForChild(childThreadId: string, runtimeId?: string): CodexSubagentRoute | null {
    const link = this.linkForChild(childThreadId, runtimeId);
    if (!link?.childThreadId) {
      return null;
    }
    return routeFromLink(link);
  }

  statusForChild(childThreadId: string, runtimeId?: string): AgentSubagentStatus | null {
    return this.linkForChild(childThreadId, runtimeId)?.status ?? null;
  }

  failUnlinkedSpawnsForParent(
    parentThreadId: string,
    runtimeId: string | undefined,
    error: string,
  ): CodexSubagentPart[] {
    const failedParts: CodexSubagentPart[] = [];
    for (const [parentItemKey, link] of this.provisionalByParentItemKey) {
      if (
        link.parentThreadId !== parentThreadId ||
        link.runtimeId !== runtimeId ||
        link.childThreadId ||
        link.status === "cancelled" ||
        link.status === "error"
      ) {
        continue;
      }
      const failedLink: CodexStoredSubagentLink = {
        ...link,
        status: "error",
        error,
      };
      this.provisionalByParentItemKey.set(parentItemKey, failedLink);
      this.linksByCorrelationKey.set(
        scopedKey(failedLink.runtimeId, failedLink.correlationKey),
        failedLink,
      );
      failedParts.push(this.toPart(failedLink));
    }
    return failedParts;
  }

  routesForParent(parentThreadId: string, runtimeId?: string): CodexSubagentRoute[] {
    const routes: CodexSubagentRoute[] = [];
    for (const link of this.linksByChildThreadId.values()) {
      if (link.parentThreadId !== parentThreadId) {
        continue;
      }
      if (runtimeId && link.runtimeId && link.runtimeId !== runtimeId) {
        continue;
      }
      const route = routeFromLink(link);
      if (route) {
        routes.push(route);
      }
    }
    return routes;
  }

  clearSession(externalSessionId: string, runtimeId?: string): void {
    const linksToClear = new Set<CodexStoredSubagentLink>();
    for (const link of this.linksByCorrelationKey.values()) {
      if (
        (runtimeId === undefined || link.runtimeId === runtimeId) &&
        (link.parentThreadId === externalSessionId || link.childThreadId === externalSessionId)
      ) {
        linksToClear.add(link);
      }
    }
    for (const link of linksToClear) {
      this.deleteLink(link);
    }
  }

  private emitRouteLearned(route: CodexSubagentRoute): void {
    for (const listener of this.routeListeners) {
      listener(route);
    }
  }

  private storeLink(link: CodexStoredSubagentLink, parentItemKey: string): void {
    const hadProvisionalBridge = this.provisionalByParentItemKey.has(parentItemKey);
    this.linksByCorrelationKey.set(scopedKey(link.runtimeId, link.correlationKey), link);
    if (!link.childThreadId || hadProvisionalBridge) {
      this.provisionalByParentItemKey.set(parentItemKey, link);
    }
    if (!link.childThreadId) {
      return;
    }
    this.linksByParentChildKey.set(
      subagentKey(link.runtimeId, link.parentThreadId, link.childThreadId),
      link,
    );
    this.linksByChildThreadId.set(childThreadKey(link.runtimeId, link.childThreadId), link);
  }

  private deleteLink(link: CodexStoredSubagentLink): void {
    this.linksByCorrelationKey.delete(scopedKey(link.runtimeId, link.correlationKey));
    if (link.childThreadId) {
      this.linksByParentChildKey.delete(
        subagentKey(link.runtimeId, link.parentThreadId, link.childThreadId),
      );
      this.linksByChildThreadId.delete(childThreadKey(link.runtimeId, link.childThreadId));
    }
    for (const [key, provisional] of this.provisionalByParentItemKey) {
      if (provisional.correlationKey === link.correlationKey) {
        this.provisionalByParentItemKey.delete(key);
      }
    }
  }

  private linkForChild(
    childThreadId: string,
    runtimeId: string | undefined,
  ): CodexStoredSubagentLink | undefined {
    if (runtimeId) {
      return (
        this.linksByChildThreadId.get(childThreadKey(runtimeId, childThreadId)) ??
        this.linksByChildThreadId.get(childThreadKey(undefined, childThreadId))
      );
    }
    const unscoped = this.linksByChildThreadId.get(childThreadKey(undefined, childThreadId));
    if (unscoped) {
      return unscoped;
    }
    let match: CodexStoredSubagentLink | undefined;
    for (const link of this.linksByChildThreadId.values()) {
      if (link.childThreadId !== childThreadId) {
        continue;
      }
      if (match && match.correlationKey !== link.correlationKey) {
        throw new CodexSubagentLinkError(
          `Codex child thread '${childThreadId}' is linked in multiple runtimes; runtimeId is required to route it.`,
        );
      }
      match = link;
    }
    return match;
  }

  private toPart(link: CodexStoredSubagentLink): CodexSubagentPart {
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
      ...(typeof link.startedAtMs === "number" ? { startedAtMs: link.startedAtMs } : {}),
      ...(typeof link.endedAtMs === "number" ? { endedAtMs: link.endedAtMs } : {}),
    };
  }
}
