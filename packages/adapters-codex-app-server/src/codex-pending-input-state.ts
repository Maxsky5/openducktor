import type { CodexAppServerRequestId } from "@openducktor/contracts";
import type { AgentPendingApprovalRequest, AgentPendingQuestionRequest } from "@openducktor/core";
import { codexServerRequestKey } from "./codex-app-server-approvals";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import type { CodexSubagentRoute } from "./codex-subagent-link-state";

export type CodexNativeServerRequest = {
  id: CodexAppServerRequestId;
  method: string;
  params?: unknown;
};

type PendingApprovalRequestProjection = Omit<
  AgentPendingApprovalRequest,
  "requestId" | "requestInstanceId"
>;

type PendingQuestionRequestProjection = Omit<
  AgentPendingQuestionRequest,
  "requestId" | "requestInstanceId"
>;

export type PendingApprovalEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingApprovalRequest;
  nativeRequest: CodexNativeServerRequest;
  route?: CodexSubagentRoute;
};

export type PendingQuestionEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingQuestionRequest;
  nativeRequest: CodexNativeServerRequest;
  questionIds: string[];
  input: Record<string, unknown>;
  route?: CodexSubagentRoute;
};

export type RegisterPendingApprovalInput = Omit<PendingApprovalEntry, "request"> & {
  request: PendingApprovalRequestProjection;
};

export type RegisterPendingQuestionInput = Omit<PendingQuestionEntry, "request"> & {
  request: PendingQuestionRequestProjection;
};

export type PendingInputRegistration<Entry> = {
  entry: Entry;
  isNew: boolean;
};

export type PendingNativeRequest =
  | { kind: "approval"; entry: PendingApprovalEntry }
  | { kind: "question"; entry: PendingQuestionEntry };

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

const newPendingRequestOccurrenceId = (): string => `pending-${crypto.randomUUID()}`;

const nativeRequestKey = (
  runtimeId: string,
  threadId: string,
  kind: "approval" | "question",
  nativeRequestId: CodexAppServerRequestId,
): string => JSON.stringify([runtimeId, threadId, kind, codexServerRequestKey(nativeRequestId)]);

export class CodexPendingInputState {
  private readonly pendingApprovalsByRequestKey = new Map<string, PendingApprovalEntry>();
  private readonly approvalRequestIdByNativeKey = new Map<string, string>();
  private readonly pendingApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly mirroredApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingQuestionsByRequestKey = new Map<string, PendingQuestionEntry>();
  private readonly questionRequestIdByNativeKey = new Map<string, string>();
  private readonly pendingQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly mirroredQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly activeTurnsByApprovalRequestKey = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsByQuestionRequestKey = new Map<string, ActiveCodexTurn>();
  private readonly approvalReplyClaims = new Set<string>();
  private readonly questionReplyClaims = new Set<string>();

  addApproval(input: RegisterPendingApprovalInput): PendingInputRegistration<PendingApprovalEntry> {
    const nativeKey = nativeRequestKey(
      input.runtimeId,
      input.threadId,
      "approval",
      input.nativeRequest.id,
    );
    const existingRequestId = this.approvalRequestIdByNativeKey.get(nativeKey);
    const existing = existingRequestId
      ? this.pendingApprovalsByRequestKey.get(existingRequestId)
      : undefined;
    if (existing) {
      return { entry: existing, isNew: false };
    }

    const requestId = newPendingRequestOccurrenceId();
    const entry: PendingApprovalEntry = {
      ...input,
      request: {
        ...input.request,
        requestId,
        requestInstanceId: requestId,
      },
    };
    this.pendingApprovalsByRequestKey.set(requestId, entry);
    this.approvalRequestIdByNativeKey.set(nativeKey, requestId);
    this.addSessionRequestId(this.pendingApprovalIdsBySessionId, entry.threadId, requestId);
    if (entry.route) {
      this.addSessionRequestId(
        this.mirroredApprovalIdsBySessionId,
        entry.route.parentExternalSessionId,
        requestId,
      );
    }
    return { entry, isNew: true };
  }

  addQuestion(input: RegisterPendingQuestionInput): PendingInputRegistration<PendingQuestionEntry> {
    const nativeKey = nativeRequestKey(
      input.runtimeId,
      input.threadId,
      "question",
      input.nativeRequest.id,
    );
    const existingRequestId = this.questionRequestIdByNativeKey.get(nativeKey);
    const existing = existingRequestId
      ? this.pendingQuestionsByRequestKey.get(existingRequestId)
      : undefined;
    if (existing) {
      return { entry: existing, isNew: false };
    }

    const requestId = newPendingRequestOccurrenceId();
    const entry: PendingQuestionEntry = {
      ...input,
      request: {
        ...input.request,
        requestId,
        requestInstanceId: requestId,
      },
    };
    this.pendingQuestionsByRequestKey.set(requestId, entry);
    this.questionRequestIdByNativeKey.set(nativeKey, requestId);
    this.addSessionRequestId(this.pendingQuestionIdsBySessionId, entry.threadId, requestId);
    if (entry.route) {
      this.addSessionRequestId(
        this.mirroredQuestionIdsBySessionId,
        entry.route.parentExternalSessionId,
        requestId,
      );
    }
    return { entry, isNew: true };
  }

  approval(requestId: string, runtimeId?: string): PendingApprovalEntry | undefined {
    return this.pendingEntry(this.pendingApprovalsByRequestKey, requestId, runtimeId);
  }

  question(requestId: string, runtimeId?: string): PendingQuestionEntry | undefined {
    return this.pendingEntry(this.pendingQuestionsByRequestKey, requestId, runtimeId);
  }

  nativeRequest(
    runtimeId: string,
    threadId: string,
    requestId: CodexAppServerRequestId,
  ): PendingNativeRequest | undefined {
    const approvalOccurrenceId = this.approvalRequestIdByNativeKey.get(
      nativeRequestKey(runtimeId, threadId, "approval", requestId),
    );
    const questionOccurrenceId = this.questionRequestIdByNativeKey.get(
      nativeRequestKey(runtimeId, threadId, "question", requestId),
    );
    const approval = approvalOccurrenceId
      ? this.pendingApprovalsByRequestKey.get(approvalOccurrenceId)
      : undefined;
    const question = questionOccurrenceId
      ? this.pendingQuestionsByRequestKey.get(questionOccurrenceId)
      : undefined;
    if (approval && question) {
      throw new Error(
        `Codex native request '${String(requestId)}' is ambiguous for runtime '${runtimeId}' and session '${threadId}'.`,
      );
    }
    if (approval) {
      return { kind: "approval", entry: approval };
    }
    return question ? { kind: "question", entry: question } : undefined;
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
      ) ?? this.pendingEntry(this.pendingApprovalsByRequestKey, requestId, runtimeId);
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
      ) ?? this.pendingEntry(this.pendingQuestionsByRequestKey, requestId, runtimeId);
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

  claimApprovalForSession(
    requestId: string,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingApprovalEntry {
    const approval = this.requireApprovalForSession(requestId, externalSessionId, runtimeId);
    this.claimReply("approval", requestId, this.approvalReplyClaims);
    return approval;
  }

  claimQuestionForSession(
    requestId: string,
    externalSessionId: string,
    runtimeId?: string,
  ): PendingQuestionEntry {
    const question = this.requireQuestionForSession(requestId, externalSessionId, runtimeId);
    this.claimReply("question", requestId, this.questionReplyClaims);
    return question;
  }

  releaseApprovalReplyClaim(requestId: string, runtimeId?: string): void {
    if (this.approval(requestId, runtimeId)) {
      this.approvalReplyClaims.delete(requestId);
    }
  }

  releaseQuestionReplyClaim(requestId: string, runtimeId?: string): void {
    if (this.question(requestId, runtimeId)) {
      this.questionReplyClaims.delete(requestId);
    }
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
    for (const approval of approvalEntries.filter(
      (entry) => entry.runtimeId === activeTurn.session.runtimeId,
    )) {
      this.activeTurnsByApprovalRequestKey.set(approval.request.requestId, activeTurn);
    }

    const questionEntries = this.pendingQuestionEntriesForIndex(
      this.pendingQuestionIdsBySessionId,
      externalSessionId,
    ).concat(
      this.pendingQuestionEntriesForIndex(this.mirroredQuestionIdsBySessionId, externalSessionId),
    );
    for (const question of questionEntries.filter(
      (entry) => entry.runtimeId === activeTurn.session.runtimeId,
    )) {
      this.activeTurnsByQuestionRequestKey.set(question.request.requestId, activeTurn);
    }
  }

  resolveApproval(requestId: string, runtimeId?: string): ActiveCodexTurn | undefined {
    const entry = this.approval(requestId, runtimeId);
    if (!entry) {
      return undefined;
    }
    const activeTurn = this.activeTurnsByApprovalRequestKey.get(requestId);
    this.pendingApprovalsByRequestKey.delete(requestId);
    this.approvalRequestIdByNativeKey.delete(
      nativeRequestKey(entry.runtimeId, entry.threadId, "approval", entry.nativeRequest.id),
    );
    this.activeTurnsByApprovalRequestKey.delete(requestId);
    this.approvalReplyClaims.delete(requestId);
    this.deleteSessionRequestId(this.pendingApprovalIdsBySessionId, requestId);
    this.deleteSessionRequestId(this.mirroredApprovalIdsBySessionId, requestId);
    return activeTurn;
  }

  resolveQuestion(requestId: string, runtimeId?: string): ActiveCodexTurn | undefined {
    const entry = this.question(requestId, runtimeId);
    if (!entry) {
      return undefined;
    }
    const activeTurn = this.activeTurnsByQuestionRequestKey.get(requestId);
    this.pendingQuestionsByRequestKey.delete(requestId);
    this.questionRequestIdByNativeKey.delete(
      nativeRequestKey(entry.runtimeId, entry.threadId, "question", entry.nativeRequest.id),
    );
    this.activeTurnsByQuestionRequestKey.delete(requestId);
    this.questionReplyClaims.delete(requestId);
    this.deleteSessionRequestId(this.pendingQuestionIdsBySessionId, requestId);
    this.deleteSessionRequestId(this.mirroredQuestionIdsBySessionId, requestId);
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
      this.approvalReplyClaims,
      this.approvalRequestIdByNativeKey,
      "approval",
    );
    this.clearPendingEntriesForSession(
      externalSessionId,
      runtimeId,
      this.pendingQuestionsByRequestKey,
      this.pendingQuestionIdsBySessionId,
      this.mirroredQuestionIdsBySessionId,
      this.activeTurnsByQuestionRequestKey,
      this.questionReplyClaims,
      this.questionRequestIdByNativeKey,
      "question",
    );
  }

  clearRuntime(runtimeId: string): void {
    for (const [requestId, entry] of [...this.pendingApprovalsByRequestKey]) {
      if (entry.runtimeId === runtimeId) {
        this.resolveApproval(requestId, runtimeId);
      }
    }
    for (const [requestId, entry] of [...this.pendingQuestionsByRequestKey]) {
      if (entry.runtimeId === runtimeId) {
        this.resolveQuestion(requestId, runtimeId);
      }
    }
  }

  private clearPendingEntriesForSession<
    Entry extends { runtimeId: string; threadId: string; nativeRequest: CodexNativeServerRequest },
  >(
    externalSessionId: string,
    runtimeId: string | undefined,
    entriesByRequestKey: Map<string, Entry>,
    ownerIndex: Map<string, Set<string>>,
    mirrorIndex: Map<string, Set<string>>,
    activeTurnsByRequestKey: Map<string, ActiveCodexTurn>,
    replyClaims: Set<string>,
    requestIdByNativeKey: Map<string, string>,
    kind: "approval" | "question",
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
      const entry = entriesByRequestKey.get(requestKey);
      entriesByRequestKey.delete(requestKey);
      if (entry) {
        requestIdByNativeKey.delete(
          nativeRequestKey(entry.runtimeId, entry.threadId, kind, entry.nativeRequest.id),
        );
      }
      activeTurnsByRequestKey.delete(requestKey);
      replyClaims.delete(requestKey);
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

    const wasMirrored = mirrorIndex.get(route.parentExternalSessionId)?.has(requestId) ?? false;
    setRoute(route);
    this.addSessionRequestId(mirrorIndex, route.parentExternalSessionId, requestId);
    return !wasMirrored;
  }

  private pendingEntry<Entry extends PendingApprovalEntry | PendingQuestionEntry>(
    entries: ReadonlyMap<string, Entry>,
    requestId: string,
    runtimeId?: string,
  ): Entry | undefined {
    const entry = entries.get(requestId);
    return entry && (!runtimeId || entry.runtimeId === runtimeId) ? entry : undefined;
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

  private claimReply(kind: "approval" | "question", requestId: string, claims: Set<string>): void {
    if (claims.has(requestId)) {
      throw new Error(`Codex ${kind} request '${requestId}' already has a reply in flight.`);
    }
    claims.add(requestId);
  }
}
