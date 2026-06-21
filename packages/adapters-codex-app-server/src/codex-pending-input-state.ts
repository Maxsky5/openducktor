import type { AgentPendingApprovalRequest, AgentPendingQuestionRequest } from "@openducktor/core";
import type { ActiveCodexTurn } from "./codex-app-server-shared";

export type PendingApprovalEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingApprovalRequest;
};

export type PendingQuestionEntry = {
  runtimeId: string;
  threadId: string;
  request: AgentPendingQuestionRequest;
  questionIds: string[];
  input: Record<string, unknown>;
};

export class CodexPendingInputState {
  private readonly pendingApprovalsByRequestId = new Map<string, PendingApprovalEntry>();
  private readonly pendingApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingQuestionsByRequestId = new Map<string, PendingQuestionEntry>();
  private readonly pendingQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly activeTurnsByApprovalRequestId = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsByQuestionRequestId = new Map<string, ActiveCodexTurn>();

  addApproval(entry: PendingApprovalEntry): void {
    const requestId = entry.request.requestId;
    this.pendingApprovalsByRequestId.set(requestId, entry);
    this.addSessionRequestId(this.pendingApprovalIdsBySessionId, entry.threadId, requestId);
  }

  addQuestion(entry: PendingQuestionEntry): void {
    const requestId = entry.request.requestId;
    this.pendingQuestionsByRequestId.set(requestId, entry);
    this.addSessionRequestId(this.pendingQuestionIdsBySessionId, entry.threadId, requestId);
  }

  approval(requestId: string): PendingApprovalEntry | undefined {
    return this.pendingApprovalsByRequestId.get(requestId);
  }

  question(requestId: string): PendingQuestionEntry | undefined {
    return this.pendingQuestionsByRequestId.get(requestId);
  }

  requireApprovalForSession(requestId: string, externalSessionId: string): PendingApprovalEntry {
    const approval = this.approval(requestId);
    if (!approval) {
      throw new Error(`Unknown Codex approval request '${requestId}'.`);
    }
    this.requireRequestSession("approval", requestId, approval.threadId, externalSessionId);
    return approval;
  }

  requireQuestionForSession(requestId: string, externalSessionId: string): PendingQuestionEntry {
    const question = this.question(requestId);
    if (!question) {
      throw new Error(`Unknown Codex question request '${requestId}'.`);
    }
    this.requireRequestSession("question", requestId, question.threadId, externalSessionId);
    return question;
  }

  pendingApprovalsForSession(externalSessionId: string): AgentPendingApprovalRequest[] {
    const requestIds = this.pendingApprovalIdsBySessionId.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestId) => this.pendingApprovalsByRequestId.get(requestId)?.request)
      .filter((request): request is AgentPendingApprovalRequest => Boolean(request));
  }

  pendingQuestionsForSession(externalSessionId: string): AgentPendingQuestionRequest[] {
    const requestIds = this.pendingQuestionIdsBySessionId.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestId) => this.pendingQuestionsByRequestId.get(requestId)?.request)
      .filter((request): request is AgentPendingQuestionRequest => Boolean(request));
  }

  bindActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void {
    for (const approval of this.pendingApprovalsForSession(externalSessionId)) {
      this.activeTurnsByApprovalRequestId.set(approval.requestId, activeTurn);
    }
    for (const question of this.pendingQuestionsForSession(externalSessionId)) {
      this.activeTurnsByQuestionRequestId.set(question.requestId, activeTurn);
    }
  }

  resolveApproval(requestId: string): ActiveCodexTurn | undefined {
    const activeTurn = this.activeTurnsByApprovalRequestId.get(requestId);
    this.pendingApprovalsByRequestId.delete(requestId);
    this.activeTurnsByApprovalRequestId.delete(requestId);
    this.deleteSessionRequestId(this.pendingApprovalIdsBySessionId, requestId);
    return activeTurn;
  }

  resolveQuestion(requestId: string): ActiveCodexTurn | undefined {
    const activeTurn = this.activeTurnsByQuestionRequestId.get(requestId);
    this.pendingQuestionsByRequestId.delete(requestId);
    this.activeTurnsByQuestionRequestId.delete(requestId);
    this.deleteSessionRequestId(this.pendingQuestionIdsBySessionId, requestId);
    return activeTurn;
  }

  clearSession(externalSessionId: string): void {
    const approvalRequestIds = this.pendingApprovalIdsBySessionId.get(externalSessionId) ?? [];
    for (const requestId of approvalRequestIds) {
      this.pendingApprovalsByRequestId.delete(requestId);
      this.activeTurnsByApprovalRequestId.delete(requestId);
    }
    this.pendingApprovalIdsBySessionId.delete(externalSessionId);

    const questionRequestIds = this.pendingQuestionIdsBySessionId.get(externalSessionId) ?? [];
    for (const requestId of questionRequestIds) {
      this.pendingQuestionsByRequestId.delete(requestId);
      this.activeTurnsByQuestionRequestId.delete(requestId);
    }
    this.pendingQuestionIdsBySessionId.delete(externalSessionId);
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

  private requireRequestSession(
    kind: "approval" | "question",
    requestId: string,
    ownerSessionId: string,
    externalSessionId: string,
  ): void {
    if (ownerSessionId === externalSessionId) {
      return;
    }
    throw new Error(
      `Codex ${kind} request '${requestId}' belongs to session '${ownerSessionId}', not '${externalSessionId}'.`,
    );
  }
}
