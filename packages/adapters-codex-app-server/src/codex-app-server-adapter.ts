import { CODEX_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentUserMessagePart,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListLiveAgentSessionsInput,
  ListSessionPresenceInput,
  LiveAgentSessionSummary,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReadSessionPresenceInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { requireCodexServerRequestId } from "./codex-app-server-approvals";
import {
  type CodexPendingInputStore,
  pendingApprovalsForCodexSession,
  pendingQuestionsForCodexSession,
} from "./codex-app-server-presence";
import {
  codexTurnKey,
  extractThreadIdFromParams,
  extractTurnId,
  parseNotificationRecord,
  parseServerRequestRecord,
} from "./codex-app-server-requests";
import {
  type CodexServerRequestHandlerContext,
  handleCodexServerRequest,
  type PendingApprovalEntry,
  type PendingQuestionEntry,
} from "./codex-app-server-server-requests";
import {
  type ActiveCodexTurn,
  CODEX_USER_INPUT_REQUEST_METHOD,
  unsupported,
} from "./codex-app-server-shared";
import {
  type CodexStreamingContext,
  type CompletedAgentMessage,
  emitCodexSessionEvent,
  emitCodexUserMessage,
  handleCodexPendingNotifications,
} from "./codex-app-server-streaming";
import type { CodexThreadStatusSnapshot } from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexTodosFromThreadRead,
  extractCodexTokenUsageTotals,
} from "./codex-app-server-transcript";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { toFileDiffs } from "./codex-file-diffs";
import { CodexHistoryPresenceOverlay } from "./codex-history-presence-overlay";
import { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import {
  CodexRuntimeEventBuffer,
  CodexRuntimeEventSubscriptions,
  type CodexRuntimeStreamEvent,
  threadIdFromRuntimeStreamEvent,
} from "./codex-runtime-events";
import { loadCodexSessionHistory } from "./codex-session-history";
import {
  applyRuntimeContextToSession,
  clearLocalSessionState,
  type InternalCodexLocalSessionStateStore,
  preserveRuntimeContextOnRestore,
  sessionStateFromThreadFork,
  sessionStateFromThreadRestore,
  sessionStateFromThreadResume,
  sessionStateFromThreadStart,
} from "./codex-session-lifecycle";
import {
  listCodexSessionPresence,
  listLiveCodexAgentSessions,
  readCodexSessionPresence,
} from "./codex-session-presence-reader";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";
import {
  type CodexTurnLifecycleContext,
  flushQueuedUserMessagesLater as flushQueuedUserMessagesLaterImpl,
  startCodexTurnForSession,
} from "./codex-turn-lifecycle";
import { searchCodexFiles } from "./file-search";
import {
  CodexModels,
  requireModelSelection,
  toCatalog,
  toTransportModelSelection,
} from "./model-catalog";
import { toCodexSkillCatalog } from "./skill-catalog";
import type {
  CodexAppServerAdapterOptions,
  CodexServerRequestRecord,
  CodexSessionState,
} from "./types";

export { createCodexAppServerClient } from "./app-server-client";

export class CodexAppServerAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly sessions = new Map<string, CodexSessionState>();
  private readonly runtimeClients: CodexRuntimeClientResolver;
  private readonly listenersBySessionId = new Map<string, Set<(event: AgentEvent) => void>>();
  private readonly pendingApprovalsByRequestId = new Map<string, PendingApprovalEntry>();
  private readonly pendingApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingQuestionsByRequestId = new Map<string, PendingQuestionEntry>();
  private readonly pendingQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly activeTurnsByApprovalRequestId = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsByQuestionRequestId = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsBySessionId = new Map<string, ActiveCodexTurn>();
  private readonly runtimeEventBuffer = new CodexRuntimeEventBuffer();
  private readonly handledStreamRequestKeysByThreadId = new Map<string, Set<string>>();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<string, CompletedAgentMessage>();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly modelByTurnKey = new Map<string, AgentModelSelection>();
  private readonly runtimeEventSubscriptions: CodexRuntimeEventSubscriptions;
  private readonly eventBacklogBySessionId = new Map<string, AgentEvent[]>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly eventMapperPipeline = createCodexEventMapperPipeline();
  private readonly models = new CodexModels();
  private readonly threadInventory = new CodexThreadInventoryReader();
  private readonly historyPresenceOverlay = new CodexHistoryPresenceOverlay();

  constructor(private readonly options: CodexAppServerAdapterOptions) {
    this.runtimeClients = new CodexRuntimeClientResolver(options);
    this.runtimeEventSubscriptions = new CodexRuntimeEventSubscriptions(options.subscribeEvents);
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return CODEX_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "list available models",
      {
        requireLive: true,
      },
    );
    return toCatalog(await this.models.list(client, runtimeId));
  }

  private clearThreadInventory(runtimeId: string): void {
    this.threadInventory.clear(runtimeId);
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "start session");
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const transportModel = toTransportModelSelection(model);

    const response = await client.threadStart({
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: transportModel.model,
      effort: transportModel.effort,
    });
    this.clearThreadInventory(runtimeId);
    const title = formatWorkflowAgentSessionTitle(input.role, input.taskId);
    const session = sessionStateFromThreadStart(input, runtimeId, model, response, title);
    const { summary } = session;
    this.historyPresenceOverlay.clear(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });

    return summary;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "resume session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);

    const response = await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    const { summary } = session;
    this.historyPresenceOverlay.clear(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);

    return summary;
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "fork session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);

    const response = await client.threadFork({
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const title = formatWorkflowAgentSessionTitle(input.role, input.taskId);
    const session = sessionStateFromThreadFork(input, runtimeId, model, response, title);
    const { summary } = session;
    this.historyPresenceOverlay.clear(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });

    return summary;
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    if (!this.sessions.has(input.externalSessionId)) {
      await this.restoreSessionState(input);
    }
    const session = this.sessions.get(input.externalSessionId);
    if (session) {
      applyRuntimeContextToSession(session, input);
    }
    await startCodexTurnForSession(
      this.turnLifecycleContext(),
      input.externalSessionId,
      input.parts,
      input.model,
    );
  }

  private bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string): boolean {
    if (activeTurn.turnId && activeTurn.turnId !== turnId) {
      return false;
    }

    const didBind = !activeTurn.turnId;
    activeTurn.turnId = turnId;
    this.modelByTurnKey.set(codexTurnKey(activeTurn.session.threadId, turnId), activeTurn.model);
    return didBind;
  }

  private flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void {
    flushQueuedUserMessagesLaterImpl(this.turnLifecycleContext(), activeTurn);
  }

  async listAvailableSlashCommands(_: ListAgentSlashCommandsInput) {
    return unsupported("listAvailableSlashCommands");
  }

  async listAvailableSkills(input: ListAgentSkillsInput): Promise<AgentSkillCatalog> {
    const { client } = await this.runtimeClients.resolve(input, "list available skills", {
      requireLive: true,
    });
    return toCodexSkillCatalog(
      await client.skillsList({
        cwd: input.workingDirectory,
        forceReload: false,
      }),
    );
  }

  async searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]> {
    const { client } = await this.runtimeClients.resolve(input, "search files", {
      requireLive: true,
    });
    return searchCodexFiles(client, {
      query: input.query,
      workingDirectory: input.workingDirectory,
    });
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const session = this.sessions.get(input.externalSessionId);
    const runtime = session
      ? {
          client: this.runtimeClients.clientForRuntime(session.runtimeId),
          runtimeId: session.runtimeId,
        }
      : await this.runtimeClients.resolve(input, "load Codex session history");
    return loadCodexSessionHistory({
      input,
      session,
      runtime,
      threadInventory: this.threadInventory,
      eventMapperPipeline: this.eventMapperPipeline,
      modelByTurnKey: this.modelByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      drainThreadReadTokenUsage: (runtimeId, threadId) =>
        this.drainThreadReadTokenUsage(runtimeId, threadId),
      rememberHistoryOnlyIdleThreadLoad: (historyInput, preResumeThread) =>
        this.historyPresenceOverlay.rememberIdleHistoryLoad(historyInput, preResumeThread),
    });
  }

  private async drainThreadReadTokenUsage(
    runtimeId: string,
    threadId: string,
  ): Promise<Map<string, CodexTokenUsageTotals>> {
    const tokenUsageByTurnId = new Map<string, CodexTokenUsageTotals>();
    const bufferedNotifications = this.runtimeEventBuffer.takeNotifications(threadId);
    const drainedNotifications = this.options.drainNotifications
      ? (await this.options.drainNotifications(runtimeId)).map(parseNotificationRecord)
      : [];
    const notifications = [...bufferedNotifications, ...drainedNotifications];
    for (const notification of notifications) {
      const notificationThreadId = extractThreadIdFromParams(notification.params);
      const notificationTurnId = extractTurnId(notification.params);
      if (
        notification.method === "thread/tokenUsage/updated" &&
        notificationThreadId === threadId &&
        notificationTurnId
      ) {
        const tokenUsage = extractCodexTokenUsageTotals(notification.params);
        if (tokenUsage) {
          tokenUsageByTurnId.set(notificationTurnId, tokenUsage);
        }
        continue;
      }
      if (!this.options.subscribeEvents) {
        this.runtimeEventBuffer.bufferNotification(notification);
      }
    }

    return tokenUsageByTurnId;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    const liveTodos = this.latestTodosBySessionId.get(input.externalSessionId);
    if (liveTodos) {
      return liveTodos;
    }
    const session = this.sessions.get(input.externalSessionId);
    const { client, runtimeId } = session
      ? {
          client: this.runtimeClients.clientForRuntime(session.runtimeId),
          runtimeId: session.runtimeId,
        }
      : await this.runtimeClients.resolve(input, "load Codex session todos");
    const isThreadReadable = await this.threadInventory.ensureThreadReadable(
      client,
      runtimeId,
      input,
    );
    if (!isThreadReadable) {
      return [];
    }
    const response = await this.threadInventory.readThreadWithTurns(
      client,
      input.externalSessionId,
    );
    const todos = codexTodosFromThreadRead(response);
    if (todos.length > 0) {
      this.latestTodosBySessionId.set(input.externalSessionId, todos);
    }
    return todos;
  }

  updateSessionModel(input: UpdateAgentSessionModelInput): void {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    if (input.model) {
      session.model = input.model;
      return;
    }
    delete session.model;
  }

  async restoreSession(input: AgentSessionRef): Promise<AgentSessionSummary> {
    return this.restoreSessionState(input);
  }

  private async restoreSessionState(
    input: AgentSessionRef | AgentSessionRuntimeRef,
  ): Promise<AgentSessionSummary> {
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "restore session state",
      {
        requireLive: true,
      },
    );
    this.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? (input.model ?? undefined) : undefined;
    if (model) {
      await this.models.validate(client, runtimeId, model);
    }

    const response = await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...("systemPrompt" in input && input.systemPrompt
        ? { developerInstructions: input.systemPrompt }
        : {}),
      ...(model ? { model: toTransportModelSelection(model).model } : {}),
      ...(model ? { effort: toTransportModelSelection(model).effort } : {}),
    });
    const session = sessionStateFromThreadRestore(input, runtimeId, model, response);
    const { summary } = session;
    const restoredSession = preserveRuntimeContextOnRestore(
      session,
      this.sessions.get(summary.externalSessionId),
    );
    this.historyPresenceOverlay.clear(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, restoredSession);
    void this.drainBufferedStreamEvents(summary.externalSessionId);
    return summary;
  }

  async releaseSession(input: AgentSessionRef): Promise<void> {
    const session = this.sessions.get(input.externalSessionId);
    clearLocalSessionState(this.localSessionStateStore(), input.externalSessionId);
    if (
      session &&
      ![...this.sessions.values()].some((candidate) => candidate.runtimeId === session.runtimeId)
    ) {
      this.stopRuntimeEventSubscription(session.runtimeId);
    }
  }

  async listLiveAgentSessions(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSummary[]> {
    return listLiveCodexAgentSessions(this.presenceReaderDeps(), input);
  }

  async listSessionPresence(
    input: ListSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot[]> {
    return listCodexSessionPresence(this.presenceReaderDeps(), input);
  }

  async readSessionPresence(
    input: ReadSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot> {
    return readCodexSessionPresence(this.presenceReaderDeps(), input);
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    const requestId = requireCodexServerRequestId(input.requestId, "approval");
    if (!this.sessions.has(input.externalSessionId)) {
      await this.restoreSessionState(input);
    }
    const session = this.sessions.get(input.externalSessionId);
    if (session) {
      applyRuntimeContextToSession(session, input);
    }
    const pending = this.pendingApprovalsByRequestId.get(input.requestId);
    if (!pending) {
      throw new Error(`Unknown Codex approval request '${input.requestId}'.`);
    }
    if (input.outcome === "approve_session" || input.outcome === "approve_turn") {
      throw new Error(`Codex approval outcome '${input.outcome}' is not supported.`);
    }
    const approved = input.outcome === "approve_once";
    await this.options.respondServerRequest(
      pending.runtimeId,
      requestId,
      {
        approved,
        outcome: input.outcome,
        message: input.message ?? (approved ? "Approved once." : "Rejected."),
      },
      undefined,
    );
    const activeTurn = this.activeTurnsByApprovalRequestId.get(input.requestId);
    this.pendingApprovalsByRequestId.delete(input.requestId);
    this.activeTurnsByApprovalRequestId.delete(input.requestId);
    for (const requestIds of this.pendingApprovalIdsBySessionId.values()) {
      requestIds.delete(input.requestId);
    }
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.continueTurnAfterPendingInput(activeTurn);
    }
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const requestId = requireCodexServerRequestId(input.requestId, "question");
    if (!this.sessions.has(input.externalSessionId)) {
      await this.restoreSessionState(input);
    }
    const session = this.sessions.get(input.externalSessionId);
    if (session) {
      applyRuntimeContextToSession(session, input);
    }
    const pending = this.pendingQuestionsByRequestId.get(input.requestId);
    if (!pending) {
      throw new Error(`Unknown Codex question request '${input.requestId}'.`);
    }
    if (pending.threadId !== input.externalSessionId) {
      throw new Error(
        `Codex question request '${input.requestId}' belongs to session '${pending.threadId}', not '${input.externalSessionId}'.`,
      );
    }
    if (input.answers.length !== pending.questionIds.length) {
      throw new Error(
        `Codex question request '${input.requestId}' expected ${pending.questionIds.length} answer set(s) but received ${input.answers.length}.`,
      );
    }
    const answers = Object.fromEntries(
      pending.questionIds.map((questionId, index) => [
        questionId,
        { answers: input.answers[index] },
      ]),
    );
    const output = JSON.stringify({ answers });
    await this.options.respondServerRequest(pending.runtimeId, requestId, { answers }, undefined);
    this.emitSessionEvent(input.externalSessionId, {
      type: "assistant_part",
      externalSessionId: input.externalSessionId,
      timestamp: new Date().toISOString(),
      part: requireNormalizedCodexToolInvocation({
        messageId: `codex-question-${input.requestId}`,
        partId: `codex-question-${input.requestId}`,
        callId: input.requestId,
        rawToolName: "request_user_input",
        status: "completed",
        input: pending.input,
        output,
        metadata: {
          codexServerRequest: true,
          method: CODEX_USER_INPUT_REQUEST_METHOD,
          requestId: input.requestId,
          questions: pending.request.questions,
          questionIds: pending.questionIds,
          answers,
        },
      }),
    });
    const activeTurn = this.activeTurnsByQuestionRequestId.get(input.requestId);
    this.pendingQuestionsByRequestId.delete(input.requestId);
    this.activeTurnsByQuestionRequestId.delete(input.requestId);
    for (const requestIds of this.pendingQuestionIdsBySessionId.values()) {
      requestIds.delete(input.requestId);
    }
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.continueTurnAfterPendingInput(activeTurn);
    }
  }

  subscribeEvents(input: AgentSessionRef, listener: (event: AgentEvent) => void): EventUnsubscribe {
    const externalSessionId = input.externalSessionId;
    const listeners = this.listenersBySessionId.get(externalSessionId) ?? new Set();
    listeners.add(listener);
    this.listenersBySessionId.set(externalSessionId, listeners);
    this.replayEventBacklog(externalSessionId, listener);
    for (const approval of pendingApprovalsForCodexSession(
      this.pendingInputStore(),
      externalSessionId,
    )) {
      listener({
        ...approval,
        type: "approval_required",
        externalSessionId,
        timestamp: new Date().toISOString(),
      });
    }
    for (const question of pendingQuestionsForCodexSession(
      this.pendingInputStore(),
      externalSessionId,
    )) {
      listener({
        ...question,
        type: "question_required",
        externalSessionId,
        timestamp: new Date().toISOString(),
      });
    }
    void this.drainBufferedStreamEvents(externalSessionId);
    return () => {
      const current = this.listenersBySessionId.get(externalSessionId);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listenersBySessionId.delete(externalSessionId);
      }
    };
  }

  async stopSession(input: AgentSessionRef): Promise<void> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    clearLocalSessionState(this.localSessionStateStore(), input.externalSessionId);
    if (
      ![...this.sessions.values()].some((candidate) => candidate.runtimeId === session.runtimeId)
    ) {
      this.stopRuntimeEventSubscription(session.runtimeId);
    }
  }

  private localSessionStateStore(): InternalCodexLocalSessionStateStore {
    return {
      sessions: this.sessions,
      listenersBySessionId: this.listenersBySessionId,
      bufferedNotificationsByThreadId: this.runtimeEventBuffer.notificationsByThreadId,
      bufferedServerRequestsByThreadId: this.runtimeEventBuffer.serverRequestsByThreadId,
      handledStreamRequestKeysByThreadId: this.handledStreamRequestKeysByThreadId,
      syntheticUserMessageTextsByThreadId: this.syntheticUserMessageTextsByThreadId,
      eventBacklogBySessionId: this.eventBacklogBySessionId,
      latestTodosBySessionId: this.latestTodosBySessionId,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      pendingApprovalIdsBySessionId: this.pendingApprovalIdsBySessionId,
      pendingApprovalsByRequestId: this.pendingApprovalsByRequestId,
      activeTurnsByApprovalRequestId: this.activeTurnsByApprovalRequestId,
      pendingQuestionIdsBySessionId: this.pendingQuestionIdsBySessionId,
      pendingQuestionsByRequestId: this.pendingQuestionsByRequestId,
      activeTurnsByQuestionRequestId: this.activeTurnsByQuestionRequestId,
      completedAgentMessagesByTurnKey: this.completedAgentMessagesByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      modelByTurnKey: this.modelByTurnKey,
    };
  }

  private pendingInputStore(): CodexPendingInputStore {
    return {
      pendingApprovalIdsBySessionId: this.pendingApprovalIdsBySessionId,
      pendingApprovalsByRequestId: this.pendingApprovalsByRequestId,
      pendingQuestionIdsBySessionId: this.pendingQuestionIdsBySessionId,
      pendingQuestionsByRequestId: this.pendingQuestionsByRequestId,
    };
  }

  private presenceReaderDeps() {
    return {
      runtimeClients: this.runtimeClients,
      threadInventory: this.threadInventory,
      sessions: this.sessions,
      historyPresenceOverlay: this.historyPresenceOverlay,
      pendingInputStore: () => this.pendingInputStore(),
      hasActiveTurn: (externalSessionId: string) => {
        const activeTurn = this.activeTurnsBySessionId.get(externalSessionId);
        return Boolean(activeTurn && !activeTurn.isTurnSettled());
      },
    };
  }

  private ensureRuntimeEventSubscription(runtimeId: string): void {
    this.runtimeEventSubscriptions.ensure(runtimeId, (event) => {
      void (async () => {
        try {
          await this.handleRuntimeStreamEvent(event);
        } catch (error) {
          const threadId = threadIdFromRuntimeStreamEvent(event);
          if (!threadId) {
            return;
          }
          this.emitSessionEvent(threadId, {
            type: "session_error",
            externalSessionId: threadId,
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
  }

  private stopRuntimeEventSubscription(runtimeId: string): void {
    this.runtimeEventSubscriptions.stop(runtimeId);
  }

  private async handleRuntimeStreamEvent(event: CodexRuntimeStreamEvent): Promise<void> {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (event.kind === "server_request") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId);
      }
      return;
    }
    const session = this.sessions.get(threadId);
    if (!session) {
      this.bufferRuntimeStreamEvent(threadId, event);
      return;
    }
    await this.processRuntimeStreamEventForSession(session, event);
  }

  private bufferRuntimeStreamEvent(
    threadId: string,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): void {
    const buffered = this.runtimeEventBuffer.bufferRuntimeStreamEvent(threadId, event);
    if (buffered.kind === "notification") {
      this.historyPresenceOverlay.clearForNotification(threadId, buffered.notification);
      return;
    }
    this.historyPresenceOverlay.clear(threadId);
  }

  private emitUnroutableRuntimeServerRequest(runtimeId: string): void {
    for (const session of this.sessions.values()) {
      if (session.runtimeId !== runtimeId) {
        continue;
      }
      this.emitSessionEvent(session.threadId, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message: "Cannot route Codex app-server request because it is missing params.threadId.",
      });
    }
  }

  private async drainBufferedStreamEvents(externalSessionId: string): Promise<void> {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    await this.handlePendingNotifications(session, []);
    const bufferedRequests = this.runtimeEventBuffer.takeServerRequests(session.threadId);
    await this.processServerRequestsForSession(session, bufferedRequests);
  }

  private async processRuntimeStreamEventForSession(
    session: CodexSessionState,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): Promise<void> {
    if (event.kind === "notification") {
      await this.handlePendingNotifications(session, [event.message]);
      return;
    }
    await this.processServerRequestsForSession(session, [parseServerRequestRecord(event.message)]);
  }

  private async processServerRequestsForSession(
    session: CodexSessionState,
    requests: CodexServerRequestRecord[],
  ): Promise<void> {
    const activeTurn = this.activeTurnsBySessionId.get(session.threadId);
    const handledRequestKeys =
      this.handledStreamRequestKeysByThreadId.get(session.threadId) ?? new Set();
    this.handledStreamRequestKeysByThreadId.set(session.threadId, handledRequestKeys);
    const hasPendingInput = await this.handleServerRequests(session, handledRequestKeys, requests);
    if (hasPendingInput && activeTurn && !activeTurn.isTurnSettled()) {
      this.bindPendingInputToActiveTurn(session.threadId, activeTurn);
    }
  }

  private bindPendingInputToActiveTurn(
    externalSessionId: string,
    activeTurn: ActiveCodexTurn,
  ): void {
    for (const approval of pendingApprovalsForCodexSession(
      this.pendingInputStore(),
      externalSessionId,
    )) {
      this.activeTurnsByApprovalRequestId.set(approval.requestId, activeTurn);
    }
    for (const question of pendingQuestionsForCodexSession(
      this.pendingInputStore(),
      externalSessionId,
    )) {
      this.activeTurnsByQuestionRequestId.set(question.requestId, activeTurn);
    }
  }

  private replayEventBacklog(
    externalSessionId: string,
    listener: (event: AgentEvent) => void,
  ): void {
    const backlog = this.eventBacklogBySessionId.get(externalSessionId);
    if (!backlog) {
      return;
    }
    this.eventBacklogBySessionId.delete(externalSessionId);
    for (const event of backlog) {
      listener(event);
    }
  }

  private async continueTurnAfterPendingInput(activeTurn: ActiveCodexTurn): Promise<void> {
    try {
      const hasPendingInput = this.options.subscribeEvents
        ? false
        : await this.handlePendingServerRequests(activeTurn.session, activeTurn.handledRequestKeys);
      if (hasPendingInput && !activeTurn.isTurnSettled()) {
        this.bindPendingInputToActiveTurn(activeTurn.session.threadId, activeTurn);
        return;
      }
      await activeTurn.turnStartPromise;
    } catch (error) {
      this.emitSessionEvent(activeTurn.session.threadId, {
        type: "session_error",
        externalSessionId: activeTurn.session.threadId,
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handlePendingServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
  ): Promise<boolean> {
    await this.handlePendingNotifications(session);
    const requests = await this.options.drainServerRequests(session.runtimeId);
    const hasPendingInput = await this.handleServerRequests(session, handledRequestKeys, requests);
    return hasPendingInput || requests.length > 0;
  }

  private async handleServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
    requests: unknown[],
  ): Promise<boolean> {
    let hasPendingInput = false;
    for (const request of requests) {
      hasPendingInput =
        (await this.handleServerRequest(
          session,
          parseServerRequestRecord(request),
          handledRequestKeys,
        )) || hasPendingInput;
    }
    return hasPendingInput;
  }

  private async handlePendingNotifications(
    session: CodexSessionState,
    notificationsFromBatch?: unknown[],
  ): Promise<void> {
    await handleCodexPendingNotifications(this.streamingContext(), session, notificationsFromBatch);
  }

  private emitUserMessage(
    session: CodexSessionState,
    parts: AgentUserMessagePart[],
    model: AgentModelSelection | undefined,
  ): void {
    emitCodexUserMessage(this.streamingContext(), session, parts, model);
  }

  private emitSessionEvent(externalSessionId: string, event: AgentEvent): void {
    emitCodexSessionEvent(this.streamingContext(), externalSessionId, event);
  }

  private streamingContext(): CodexStreamingContext {
    return {
      subscribeEvents: Boolean(this.options.subscribeEvents),
      ...(this.options.drainNotifications
        ? { drainNotifications: this.options.drainNotifications }
        : {}),
      bufferedNotificationsByThreadId: this.runtimeEventBuffer.notificationsByThreadId,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      syntheticUserMessageTextsByThreadId: this.syntheticUserMessageTextsByThreadId,
      completedAgentMessagesByTurnKey: this.completedAgentMessagesByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      modelByTurnKey: this.modelByTurnKey,
      eventBacklogBySessionId: this.eventBacklogBySessionId,
      latestTodosBySessionId: this.latestTodosBySessionId,
      eventMapperPipeline: this.eventMapperPipeline,
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      flushQueuedUserMessagesLater: (activeTurn) => this.flushQueuedUserMessagesLater(activeTurn),
      bufferNotification: (notification) =>
        this.runtimeEventBuffer.bufferNotification(notification),
      setSessionLiveStatus: (session, liveStatus) => this.setSessionLiveStatus(session, liveStatus),
      listenersForSession: (externalSessionId) => this.listenersBySessionId.get(externalSessionId),
    };
  }

  private turnLifecycleContext(): CodexTurnLifecycleContext {
    return {
      subscribeEvents: Boolean(this.options.subscribeEvents),
      shouldDrainNotifications: Boolean(this.options.drainNotifications),
      sessions: this.sessions,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      clientForRuntime: (runtimeId) => this.runtimeClients.clientForRuntime(runtimeId),
      validateModel: (client, runtimeId, model) => this.models.validate(client, runtimeId, model),
      ensureRuntimeEventSubscription: (runtimeId) => this.ensureRuntimeEventSubscription(runtimeId),
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      bindPendingInputToActiveTurn: (externalSessionId, activeTurn) =>
        this.bindPendingInputToActiveTurn(externalSessionId, activeTurn),
      setSessionLiveStatus: (session, liveStatus) => this.setSessionLiveStatus(session, liveStatus),
      handlePendingServerRequests: (session, handledRequestKeys) =>
        this.handlePendingServerRequests(session, handledRequestKeys),
      emitUserMessage: (session, parts, model) => this.emitUserMessage(session, parts, model),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    };
  }

  private setSessionLiveStatus(
    session: CodexSessionState,
    liveStatus: CodexThreadStatusSnapshot,
  ): void {
    session.liveStatus = liveStatus;
    session.summary = {
      ...session.summary,
      status: liveStatus.agentSessionStatus,
    };
  }

  private async handleServerRequest(
    session: CodexSessionState,
    rawRequest: CodexServerRequestRecord,
    handledRequestKeys: Set<string>,
  ): Promise<boolean> {
    return handleCodexServerRequest(
      this.serverRequestContext(),
      session,
      rawRequest,
      handledRequestKeys,
    );
  }

  private serverRequestContext(): CodexServerRequestHandlerContext {
    return {
      respondServerRequest: this.options.respondServerRequest,
      pendingApprovalsByRequestId: this.pendingApprovalsByRequestId,
      pendingApprovalIdsBySessionId: this.pendingApprovalIdsBySessionId,
      pendingQuestionsByRequestId: this.pendingQuestionsByRequestId,
      pendingQuestionIdsBySessionId: this.pendingQuestionIdsBySessionId,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      flushQueuedUserMessagesLater: (activeTurn) => this.flushQueuedUserMessagesLater(activeTurn),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    };
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    const session = this.sessions.get(input.externalSessionId);
    const { client } = session
      ? { client: this.runtimeClients.clientForRuntime(session.runtimeId) }
      : await this.runtimeClients.resolve(input, "load Codex session diff");
    const diff = await client.turnDiff({
      threadId: input.externalSessionId,
      ...(input.runtimeHistoryAnchor ? { turnId: input.runtimeHistoryAnchor } : {}),
    });
    return toFileDiffs(diff);
  }

  async loadFileStatus(
    _: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return unsupported("loadFileStatus");
  }
}
