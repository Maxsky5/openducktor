import type { AgentPendingApprovalRequest, AgentPendingQuestionRequest } from "@openducktor/core";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import type { CodexSubagentRoute } from "./codex-subagent-link-state";

export type PendingApprovalEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingApprovalRequest;
  route?: CodexSubagentRoute;
};

export type PendingQuestionEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingQuestionRequest;
  questionIds: string[];
  input: Record<string, unknown>;
  route?: CodexSubagentRoute;
};

export type PendingApprovalEventEntry = {
  request: AgentPendingApprovalRequest;
  route?: CodexSubagentRoute;
};

export type PendingQuestionEventEntry = {
  request: AgentPendingQuestionRequest;
  route?: CodexSubagentRoute;
};

export type PendingInputRouteApplication = {
  approvals: PendingApprovalEventEntry[];
  questions: PendingQuestionEventEntry[];
};

const sameRoute = (a: CodexSubagentRoute, b: CodexSubagentRoute): boolean =>
  a.runtimeId === b.runtimeId &&
  a.parentExternalSessionId === b.parentExternalSessionId &&
  a.childExternalSessionId === b.childExternalSessionId &&
  a.subagentCorrelationKey === b.subagentCorrelationKey;

const pendingRequestKey = (runtimeId: string, requestId: string): string =>
  `${runtimeId}\u0000${requestId}`;

export class CodexPendingInputState {
  private readonly pendingApprovalsByRequestKey = new Map<string, PendingApprovalEntry>();
  private readonly pendingApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly mirroredApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingQuestionsByRequestKey = new Map<string, PendingQuestionEntry>();
  private readonly pendingQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly mirroredQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly activeTurnsByApprovalRequestKey = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsByQuestionRequestKey = new Map<string, ActiveCodexTurn>();

  addApproval(entry: PendingApprovalEntry): void {
    const requestId = entry.request.requestId;
    const requestKey = pendingRequestKey(entry.runtimeId, requestId);
    this.pendingApprovalsByRequestKey.set(requestKey, entry);
    this.addSessionRequestId(this.pendingApprovalIdsBySessionId, entry.threadId, requestKey);
    if (entry.route) {
      this.addSessionRequestId(
        this.mirroredApprovalIdsBySessionId,
        entry.route.parentExternalSessionId,
        requestKey,
      );
    }
  }

  addQuestion(entry: PendingQuestionEntry): void {
    const requestId = entry.request.requestId;
    const requestKey = pendingRequestKey(entry.runtimeId, requestId);
    this.pendingQuestionsByRequestKey.set(requestKey, entry);
    this.addSessionRequestId(this.pendingQuestionIdsBySessionId, entry.threadId, requestKey);
    if (entry.route) {
      this.addSessionRequestId(
        this.mirroredQuestionIdsBySessionId,
        entry.route.parentExternalSessionId,
        requestKey,
      );
    }
  }

  approval(requestId: string, runtimeId?: string): PendingApprovalEntry | undefined {
    return this.pendingEntry(this.pendingApprovalsByRequestKey, "approval", requestId, runtimeId);
  }

  question(requestId: string, runtimeId?: string): PendingQuestionEntry | undefined {
    return this.pendingEntry(this.pendingQuestionsByRequestKey, "question", requestId, runtimeId);
  }

  requireApprovalForSession(
    requestId: string,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingApprovalEntry {
    const approval =
      this.pendingEntryForSession(
        this.pendingApprovalsByRequestKey,
        this.pendingApprovalIdsBySessionId,
        this.mirroredApprovalIdsBySessionId,
        "approval",
        requestId,
        externalSessionId,
        runtimeId,
      ) ?? this.pendingEntry(this.pendingApprovalsByRequestKey, "approval", requestId, runtimeId);
    if (!approval) {
      throw new Error(`Unknown Codex approval request '${requestId}'.`);
    }
    this.requireRequestSession(
      "approval",
      requestId,
      approval.threadId,
      externalSessionId,
      approval.route,
    );
    return approval;
  }

  requireQuestionForSession(
    requestId: string,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingQuestionEntry {
    const question =
      this.pendingEntryForSession(
        this.pendingQuestionsByRequestKey,
        this.pendingQuestionIdsBySessionId,
        this.mirroredQuestionIdsBySessionId,
        "question",
        requestId,
        externalSessionId,
        runtimeId,
      ) ?? this.pendingEntry(this.pendingQuestionsByRequestKey, "question", requestId, runtimeId);
    if (!question) {
      throw new Error(`Unknown Codex question request '${requestId}'.`);
    }
    this.requireRequestSession(
      "question",
      requestId,
      question.threadId,
      externalSessionId,
      question.route,
    );
    return question;
  }

  pendingApprovalsForSession(
    externalSessionId: string,
    runtimeId?: string,
  ): AgentPendingApprovalRequest[] {
    return this.pendingApprovalEntriesForIndex(
      this.pendingApprovalIdsBySessionId,
      externalSessionId,
      runtimeId,
    ).map((entry) => entry.request);
  }

  pendingApprovalEventsForSession(
    externalSessionId: string,
    runtimeId?: string,
  ): PendingApprovalEventEntry[] {
    return this.pendingApprovalEntriesForIndex(
      this.pendingApprovalIdsBySessionId,
      externalSessionId,
      runtimeId,
    )
      .concat(
        this.pendingApprovalEntriesForIndex(
          this.mirroredApprovalIdsBySessionId,
          externalSessionId,
          runtimeId,
        ),
      )
      .map((entry) => ({
        request: entry.request,
        ...(entry.route ? { route: entry.route } : {}),
      }));
  }

  pendingQuestionsForSession(
    externalSessionId: string,
    runtimeId?: string,
  ): AgentPendingQuestionRequest[] {
    return this.pendingQuestionEntriesForIndex(
      this.pendingQuestionIdsBySessionId,
      externalSessionId,
      runtimeId,
    ).map((entry) => entry.request);
  }

  pendingQuestionEventsForSession(
    externalSessionId: string,
    runtimeId?: string,
  ): PendingQuestionEventEntry[] {
    return this.pendingQuestionEntriesForIndex(
      this.pendingQuestionIdsBySessionId,
      externalSessionId,
      runtimeId,
    )
      .concat(
        this.pendingQuestionEntriesForIndex(
          this.mirroredQuestionIdsBySessionId,
          externalSessionId,
          runtimeId,
        ),
      )
      .map((entry) => ({
        request: entry.request,
        ...(entry.route ? { route: entry.route } : {}),
      }));
  }

  applyRouteToPendingInput(route: CodexSubagentRoute): PendingInputRouteApplication {
    const approvals: PendingApprovalEventEntry[] = [];
    for (const entry of this.pendingApprovalEntriesForIndex(
      this.pendingApprovalIdsBySessionId,
      route.childExternalSessionId,
    )) {
      if (this.applyApprovalRoute(entry, route)) {
        approvals.push({ request: entry.request, route });
      }
    }

    const questions: PendingQuestionEventEntry[] = [];
    for (const entry of this.pendingQuestionEntriesForIndex(
      this.pendingQuestionIdsBySessionId,
      route.childExternalSessionId,
    )) {
      if (this.applyQuestionRoute(entry, route)) {
        questions.push({ request: entry.request, route });
      }
    }

    return { approvals, questions };
  }

  bindActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void {
    const approvalEntries = this.pendingApprovalEntriesForIndex(
      this.pendingApprovalIdsBySessionId,
      externalSessionId,
    ).concat(
      this.pendingApprovalEntriesForIndex(this.mirroredApprovalIdsBySessionId, externalSessionId),
    );
    for (const approval of approvalEntries) {
      this.activeTurnsByApprovalRequestKey.set(
        pendingRequestKey(approval.runtimeId, approval.request.requestId),
        activeTurn,
      );
    }

    const questionEntries = this.pendingQuestionEntriesForIndex(
      this.pendingQuestionIdsBySessionId,
      externalSessionId,
    ).concat(
      this.pendingQuestionEntriesForIndex(this.mirroredQuestionIdsBySessionId, externalSessionId),
    );
    for (const question of questionEntries) {
      this.activeTurnsByQuestionRequestKey.set(
        pendingRequestKey(question.runtimeId, question.request.requestId),
        activeTurn,
      );
    }
  }

  resolveApproval(requestId: string, runtimeId?: string): ActiveCodexTurn | undefined {
    const entry = this.approval(requestId, runtimeId);
    if (!entry) {
      return undefined;
    }
    const requestKey = pendingRequestKey(entry.runtimeId, requestId);
    const activeTurn = this.activeTurnsByApprovalRequestKey.get(requestKey);
    this.pendingApprovalsByRequestKey.delete(requestKey);
    this.activeTurnsByApprovalRequestKey.delete(requestKey);
    this.deleteSessionRequestId(this.pendingApprovalIdsBySessionId, requestKey);
    this.deleteSessionRequestId(this.mirroredApprovalIdsBySessionId, requestKey);
    return activeTurn;
  }

  resolveQuestion(requestId: string, runtimeId?: string): ActiveCodexTurn | undefined {
    const entry = this.question(requestId, runtimeId);
    if (!entry) {
      return undefined;
    }
    const requestKey = pendingRequestKey(entry.runtimeId, requestId);
    const activeTurn = this.activeTurnsByQuestionRequestKey.get(requestKey);
    this.pendingQuestionsByRequestKey.delete(requestKey);
    this.activeTurnsByQuestionRequestKey.delete(requestKey);
    this.deleteSessionRequestId(this.pendingQuestionIdsBySessionId, requestKey);
    this.deleteSessionRequestId(this.mirroredQuestionIdsBySessionId, requestKey);
    return activeTurn;
  }

  clearSession(externalSessionId: string, runtimeId?: string): void {
    this.clearPendingEntriesForSession(
      externalSessionId,
      runtimeId,
      this.pendingApprovalsByRequestKey,
      this.pendingApprovalIdsBySessionId,
      this.mirroredApprovalIdsBySessionId,
      this.activeTurnsByApprovalRequestKey,
    );
    this.clearPendingEntriesForSession(
      externalSessionId,
      runtimeId,
      this.pendingQuestionsByRequestKey,
      this.pendingQuestionIdsBySessionId,
      this.mirroredQuestionIdsBySessionId,
      this.activeTurnsByQuestionRequestKey,
    );
  }

  private clearPendingEntriesForSession<Entry extends { runtimeId: string }>(
    externalSessionId: string,
    runtimeId: string | undefined,
    entriesByRequestKey: Map<string, Entry>,
    ownerIndex: Map<string, Set<string>>,
    mirrorIndex: Map<string, Set<string>>,
    activeTurnsByRequestKey: Map<string, ActiveCodexTurn>,
  ): void {
    const belongsToRuntime = (requestKey: string): boolean =>
      !runtimeId || entriesByRequestKey.get(requestKey)?.runtimeId === runtimeId;
    const ownerRequestKeys = [...(ownerIndex.get(externalSessionId) ?? [])].filter(
      belongsToRuntime,
    );
    const mirroredRequestKeys = [...(mirrorIndex.get(externalSessionId) ?? [])].filter(
      belongsToRuntime,
    );

    for (const requestKey of ownerRequestKeys) {
      entriesByRequestKey.delete(requestKey);
      activeTurnsByRequestKey.delete(requestKey);
      this.deleteSessionRequestId(ownerIndex, requestKey);
      this.deleteSessionRequestId(mirrorIndex, requestKey);
    }
    for (const requestKey of mirroredRequestKeys) {
      if (activeTurnsByRequestKey.get(requestKey)?.session.threadId === externalSessionId) {
        activeTurnsByRequestKey.delete(requestKey);
      }
      this.deleteSessionRequestId(mirrorIndex, requestKey);
    }
  }

  private pendingApprovalEntriesForIndex(
    index: Map<string, Set<string>>,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingApprovalEntry[] {
    const requestIds = index.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestKey) => this.pendingApprovalsByRequestKey.get(requestKey))
      .filter(
        (entry): entry is PendingApprovalEntry =>
          entry !== undefined && (!runtimeId || entry.runtimeId === runtimeId),
      );
  }

  private pendingQuestionEntriesForIndex(
    index: Map<string, Set<string>>,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingQuestionEntry[] {
    const requestIds = index.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestKey) => this.pendingQuestionsByRequestKey.get(requestKey))
      .filter(
        (entry): entry is PendingQuestionEntry =>
          entry !== undefined && (!runtimeId || entry.runtimeId === runtimeId),
      );
  }

  private addSessionRequestId(
    index: Map<string, Set<string>>,
    threadId: string,
    requestId: string,
  ): void {
    const requestIds = index.get(threadId) ?? new Set();
    requestIds.add(requestId);
    index.set(threadId, requestIds);
  }

  private deleteSessionRequestId(index: Map<string, Set<string>>, requestId: string): void {
    for (const [threadId, requestIds] of index) {
      requestIds.delete(requestId);
      if (requestIds.size === 0) {
        index.delete(threadId);
      }
    }
  }

  private applyApprovalRoute(entry: PendingApprovalEntry, route: CodexSubagentRoute): boolean {
    return this.applyRoute(
      "approval",
      entry.request.requestId,
      entry.runtimeId,
      entry.threadId,
      entry.route,
      route,
      (nextRoute) => {
        entry.route = nextRoute;
      },
      this.mirroredApprovalIdsBySessionId,
    );
  }

  private applyQuestionRoute(entry: PendingQuestionEntry, route: CodexSubagentRoute): boolean {
    return this.applyRoute(
      "question",
      entry.request.requestId,
      entry.runtimeId,
      entry.threadId,
      entry.route,
      route,
      (nextRoute) => {
        entry.route = nextRoute;
      },
      this.mirroredQuestionIdsBySessionId,
    );
  }

  private applyRoute(
    kind: "approval" | "question",
    requestId: string,
    runtimeId: string,
    ownerThreadId: string,
    existingRoute: CodexSubagentRoute | undefined,
    route: CodexSubagentRoute,
    setRoute: (route: CodexSubagentRoute) => void,
    mirrorIndex: Map<string, Set<string>>,
  ): boolean {
    if (route.runtimeId && route.runtimeId !== runtimeId) {
      return false;
    }
    if (ownerThreadId !== route.childExternalSessionId) {
      return false;
    }
    if (existingRoute && !sameRoute(existingRoute, route)) {
      throw new Error(
        `Codex ${kind} request '${requestId}' already has route '${existingRoute.parentExternalSessionId}' -> '${existingRoute.childExternalSessionId}', not '${route.parentExternalSessionId}' -> '${route.childExternalSessionId}'.`,
      );
    }

    const requestKey = pendingRequestKey(runtimeId, requestId);
    const wasMirrored = mirrorIndex.get(route.parentExternalSessionId)?.has(requestKey) ?? false;
    setRoute(route);
    this.addSessionRequestId(mirrorIndex, route.parentExternalSessionId, requestKey);
    return !wasMirrored;
  }

  private pendingEntry<Entry extends PendingApprovalEntry | PendingQuestionEntry>(
    entries: ReadonlyMap<string, Entry>,
    kind: "approval" | "question",
    requestId: string,
    runtimeId?: string,
  ): Entry | undefined {
    if (runtimeId) {
      return entries.get(pendingRequestKey(runtimeId, requestId));
    }
    const matches = [...entries.values()].filter((entry) => entry.request.requestId === requestId);
    if (matches.length > 1) {
      throw new Error(
        `Codex ${kind} request '${requestId}' exists in multiple runtimes; runtimeId is required.`,
      );
    }
    return matches[0];
  }

  private pendingEntryForSession<Entry extends PendingApprovalEntry | PendingQuestionEntry>(
    entries: ReadonlyMap<string, Entry>,
    ownerIndex: ReadonlyMap<string, Set<string>>,
    mirrorIndex: ReadonlyMap<string, Set<string>>,
    kind: "approval" | "question",
    requestId: string,
    externalSessionId: string,
    runtimeId?: string,
  ): Entry | undefined {
    const requestKeys = new Set([
      ...(ownerIndex.get(externalSessionId) ?? []),
      ...(mirrorIndex.get(externalSessionId) ?? []),
    ]);
    const matches = [...requestKeys]
      .map((requestKey) => entries.get(requestKey))
      .filter(
        (entry): entry is Entry =>
          entry !== undefined &&
          entry.request.requestId === requestId &&
          (!runtimeId || entry.runtimeId === runtimeId),
      );
    if (matches.length > 1) {
      throw new Error(
        `Codex ${kind} request '${requestId}' is ambiguous for session '${externalSessionId}'.`,
      );
    }
    return matches[0];
  }

  private requireRequestSession(
    kind: "approval" | "question",
    requestId: string,
    ownerSessionId: string,
    externalSessionId: string,
    route: CodexSubagentRoute | undefined,
  ): void {
    if (ownerSessionId === externalSessionId) {
      return;
    }
    if (
      route &&
      route.childExternalSessionId === ownerSessionId &&
      route.parentExternalSessionId === externalSessionId
    ) {
      return;
    }
    throw new Error(
      `Codex ${kind} request '${requestId}' belongs to session '${ownerSessionId}', not '${externalSessionId}'.`,
    );
  }
}
