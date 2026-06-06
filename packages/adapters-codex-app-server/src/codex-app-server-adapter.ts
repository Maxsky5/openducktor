import { CODEX_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionPort,
  AgentSessionPresenceSnapshot,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentUserMessagePart,
  AgentWorkspaceInspectionPort,
  AttachAgentSessionInput,
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
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import {
  toPresenceSnapshot as buildPresenceSnapshot,
  stalePresence,
  toPresenceSnapshotFromThread,
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
  type CodexLiveEventPump,
  isPlainObject,
  MAX_CODEX_BUFFERED_THREAD_COUNT,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
  trimOldestMapKeys,
  unsupported,
} from "./codex-app-server-shared";
import {
  type CodexStreamingContext,
  type CompletedAgentMessage,
  emitCodexSessionEvent,
  emitCodexUserMessage,
  handleCodexPendingNotifications,
} from "./codex-app-server-streaming";
import {
  type CodexThreadInventory,
  type CodexThreadSnapshot,
  type CodexThreadStatusSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexTodosFromThreadRead,
  codexTurnItemsFromThreadRead,
  extractCodexTokenUsageTotals,
  toFileDiffs,
  toHistoryMessage,
} from "./codex-app-server-transcript";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import {
  clearLocalSessionState,
  type InternalCodexLocalSessionStateStore,
  sessionStateFromThreadAttach,
  sessionStateFromThreadFork,
  sessionStateFromThreadResume,
  sessionStateFromThreadStart,
} from "./codex-session-lifecycle";
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
  CodexNotificationRecord,
  CodexServerRequestRecord,
  CodexSessionState,
} from "./types";

export { createCodexAppServerClient } from "./app-server-client";

const IDLE_CODEX_THREAD_STATUS = codexThreadStatusSnapshot("idle");

type HistoryOnlyIdleThreadLoad = {
  repoPath: string;
  workingDirectory: string;
};

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
  private readonly bufferedNotificationsByThreadId = new Map<string, CodexNotificationRecord[]>();
  private readonly bufferedServerRequestsByThreadId = new Map<string, CodexServerRequestRecord[]>();
  private readonly handledStreamRequestKeysByThreadId = new Map<string, Set<string>>();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<string, CompletedAgentMessage>();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly modelByTurnKey = new Map<string, AgentModelSelection>();
  private readonly runtimeEventSubscriptionsByRuntimeId = new Map<string, CodexLiveEventPump>();
  private readonly eventBacklogBySessionId = new Map<string, AgentEvent[]>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly eventMapperPipeline = createCodexEventMapperPipeline();
  private readonly models = new CodexModels();
  private readonly threadInventory = new CodexThreadInventoryReader();
  private readonly historyOnlyIdleThreadLoadsById = new Map<string, HistoryOnlyIdleThreadLoad>();

  constructor(private readonly options: CodexAppServerAdapterOptions) {
    this.runtimeClients = new CodexRuntimeClientResolver(options);
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
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });
    const { summary } = session;
    this.clearHistoryOnlyIdleThreadLoad(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);

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
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    const { summary } = session;
    this.clearHistoryOnlyIdleThreadLoad(summary.externalSessionId);
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
    const session = sessionStateFromThreadFork(input, runtimeId, model, response);
    const { summary } = session;
    this.clearHistoryOnlyIdleThreadLoad(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);

    return summary;
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
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

  hasSession(externalSessionId: string): boolean {
    return this.sessions.has(externalSessionId);
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
  ): Promise<import("@openducktor/core").AgentSessionHistoryMessage[]> {
    const session = this.sessions.get(input.externalSessionId);
    const { client, runtimeId } = session
      ? {
          client: this.runtimeClients.clientForRuntime(session.runtimeId),
          runtimeId: session.runtimeId,
        }
      : await this.runtimeClients.resolve(input, "load Codex session history");
    const historyAttachment = session
      ? null
      : await this.threadInventory.attachThreadForHistory(client, runtimeId, input);
    const threadResponse = session
      ? await this.threadInventory.readLoadedThread(client, runtimeId, input)
      : historyAttachment?.response;
    if (!threadResponse) {
      return [];
    }
    if (historyAttachment) {
      this.rememberHistoryOnlyIdleThreadLoad(input, historyAttachment.preResumeThread);
    }
    const response = await this.threadInventory.readThreadWithTurns(
      client,
      input.externalSessionId,
    );
    const tokenUsageByTurnId = await this.drainThreadReadTokenUsage(
      runtimeId,
      input.externalSessionId,
    );
    const threadItems = codexTurnItemsFromThreadRead(response);
    return threadItems
      .flatMap(({ item, turnId, timestamp, isFinalAgentMessage, turnTiming, model }, index) => {
        const turnModel =
          model ??
          (turnId
            ? this.modelByTurnKey.get(codexTurnKey(input.externalSessionId, turnId))
            : undefined);
        let finalTokenUsage: CodexTokenUsageTotals | null = null;
        if (isFinalAgentMessage && turnId) {
          finalTokenUsage =
            tokenUsageByTurnId.get(turnId) ??
            this.tokenUsageByTurnKey.get(codexTurnKey(input.externalSessionId, turnId)) ??
            null;
        }
        const canonicalEvents = this.eventMapperPipeline.runThreadItem(
          {
            item,
            index,
            ...(timestamp ? { timestamp } : {}),
            ...(isFinalAgentMessage ? { isFinalAgentMessage } : {}),
          },
          {
            source: "thread_read",
            threadId: input.externalSessionId,
            ...(timestamp ? { timestamp } : {}),
          },
        );
        if (canonicalEvents.length > 0) {
          const history = projectCodexCanonicalEventsToHistory(canonicalEvents, turnModel);
          if (isFinalAgentMessage) {
            return history.map((message) =>
              applyFinalAssistantTurnMetadata(message, turnTiming, finalTokenUsage),
            );
          }
          return history;
        }
        const message = toHistoryMessage(
          item,
          `codex-history-${index}`,
          turnModel,
          timestamp ?? undefined,
          isFinalAgentMessage,
          turnTiming,
          finalTokenUsage,
        );
        if (!message) {
          return [];
        }
        return [message];
      })
      .filter((message): message is import("@openducktor/core").AgentSessionHistoryMessage =>
        Boolean(message),
      );
  }

  private async drainThreadReadTokenUsage(
    runtimeId: string,
    threadId: string,
  ): Promise<Map<string, CodexTokenUsageTotals>> {
    const tokenUsageByTurnId = new Map<string, CodexTokenUsageTotals>();
    const bufferedNotifications = this.bufferedNotificationsByThreadId.get(threadId) ?? [];
    this.bufferedNotificationsByThreadId.delete(threadId);
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
        this.bufferNotification(notification);
      }
    }

    return tokenUsageByTurnId;
  }

  private bufferNotification(notification: CodexNotificationRecord): void {
    const notificationThreadId = extractThreadIdFromParams(notification.params);
    if (!notificationThreadId) {
      return;
    }

    const buffered = this.bufferedNotificationsByThreadId.get(notificationThreadId) ?? [];
    buffered.push(notification);
    if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.bufferedNotificationsByThreadId.set(notificationThreadId, buffered);
    trimOldestMapKeys(this.bufferedNotificationsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
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
    const responseWithoutTurns = await this.threadInventory.readLoadedThread(
      client,
      runtimeId,
      input,
    );
    if (!responseWithoutTurns) {
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

  async attachSession(input: AttachAgentSessionInput): Promise<AgentSessionSummary> {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "attach session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? input.model : undefined;
    if (model) {
      await this.models.validate(client, runtimeId, model);
    }

    const response = await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
      ...(model ? { model: toTransportModelSelection(model).model } : {}),
      ...(model ? { effort: toTransportModelSelection(model).effort } : {}),
    });
    const session = sessionStateFromThreadAttach(input, runtimeId, model, response);
    const { summary } = session;
    this.clearHistoryOnlyIdleThreadLoad(summary.externalSessionId);
    this.sessions.set(summary.externalSessionId, session);
    void this.drainBufferedStreamEvents(summary.externalSessionId);
    return summary;
  }

  async detachSession(externalSessionId: string): Promise<void> {
    const session = this.sessions.get(externalSessionId);
    clearLocalSessionState(this.localSessionStateStore(), externalSessionId);
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
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "list live sessions", {
      requireLive: true,
    });
    const inventory = await this.threadInventory.refresh(client, runtimeId);
    this.clearUnloadedHistoryOnlyIdleLoads(inventory);
    if (inventory.loadedIds.size === 0) {
      return [];
    }
    const directories = new Set(input.directories ?? []);
    return [...inventory.threadsById.values()]
      .filter((thread) => inventory.loadedIds.has(thread.id))
      .filter((thread) => directories.size === 0 || directories.has(thread.cwd))
      .map((thread) => this.threadSnapshotForRemotePresence(thread, input.repoPath))
      .map((thread) => ({
        externalSessionId: thread.id,
        title: thread.title,
        workingDirectory: thread.cwd,
        startedAt: thread.startedAt,
        status: thread.status.status,
      }));
  }

  async listSessionPresence(
    input: ListSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot[]> {
    const directories = new Set(input.directories ?? []);
    const localSessions = [...this.sessions.values()]
      .filter((session) => session.repoPath === input.repoPath)
      .filter((session) => directories.size === 0 || directories.has(session.workingDirectory));
    const inventoryByRuntimeId = new Map<string, Promise<CodexThreadInventory>>();
    const refreshRuntimeInventory = (runtimeId: string): Promise<CodexThreadInventory> => {
      const existing = inventoryByRuntimeId.get(runtimeId);
      if (existing) {
        return existing;
      }
      const inventory = this.threadInventory.refresh(
        this.runtimeClients.clientForRuntime(runtimeId),
        runtimeId,
      );
      inventoryByRuntimeId.set(runtimeId, inventory);
      return inventory;
    };
    const localSnapshots = await Promise.all(
      localSessions.map(async (session) =>
        this.toRefreshedPresenceSnapshot(session, await refreshRuntimeInventory(session.runtimeId)),
      ),
    );
    const localThreadIds = new Set(localSessions.map((session) => session.threadId));
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "list session presence",
      {
        requireLive: true,
      },
    );
    const inventory = await this.threadInventory.refresh(client, runtimeId);
    this.clearUnloadedHistoryOnlyIdleLoads(inventory);
    const remoteSnapshots = [...inventory.threadsById.values()]
      .filter((thread) => inventory.loadedIds.has(thread.id))
      .filter((thread) => !localThreadIds.has(thread.id))
      .filter((thread) => directories.size === 0 || directories.has(thread.cwd))
      .map((thread) =>
        toPresenceSnapshotFromThread(
          this.threadSnapshotForRemotePresence(thread, input.repoPath),
          input,
          runtimeId,
        ),
      );
    return [...localSnapshots, ...remoteSnapshots];
  }

  async readSessionPresence(
    input: ReadSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      return this.readRemoteSessionPresence(input);
    }
    const inventory = await this.threadInventory.refresh(
      this.runtimeClients.clientForRuntime(session.runtimeId),
      session.runtimeId,
    );
    return this.toRefreshedPresenceSnapshot(session, inventory, input);
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    const requestId = requireCodexServerRequestId(input.requestId, "approval");
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

  subscribeEvents(
    externalSessionId: string,
    listener: (event: AgentEvent) => void,
  ): EventUnsubscribe {
    if (!this.sessions.has(externalSessionId)) {
      throw new Error(`Unknown Codex session '${externalSessionId}'.`);
    }
    const listeners = this.listenersBySessionId.get(externalSessionId) ?? new Set();
    listeners.add(listener);
    this.listenersBySessionId.set(externalSessionId, listeners);
    this.replayEventBacklog(externalSessionId, listener);
    for (const approval of this.pendingApprovalsForSession(externalSessionId)) {
      listener({
        ...approval,
        type: "approval_required",
        externalSessionId,
        timestamp: new Date().toISOString(),
      });
    }
    for (const question of this.pendingQuestionsForSession(externalSessionId)) {
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

  async stopSession(externalSessionId: string): Promise<void> {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${externalSessionId}'.`);
    }
    clearLocalSessionState(this.localSessionStateStore(), externalSessionId);
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
      bufferedNotificationsByThreadId: this.bufferedNotificationsByThreadId,
      bufferedServerRequestsByThreadId: this.bufferedServerRequestsByThreadId,
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

  private ensureRuntimeEventSubscription(runtimeId: string): void {
    if (!this.options.subscribeEvents) {
      return;
    }
    const existing = this.runtimeEventSubscriptionsByRuntimeId.get(runtimeId);
    if (existing) {
      return;
    }
    const pump: CodexLiveEventPump = {
      unsubscribe: null,
    };
    this.runtimeEventSubscriptionsByRuntimeId.set(runtimeId, pump);
    const unsubscribe = this.options.subscribeEvents(runtimeId, (event) => {
      if (event.runtimeId !== runtimeId) {
        return;
      }
      void (async () => {
        try {
          await this.handleRuntimeStreamEvent(event);
        } catch (error) {
          const threadId = this.threadIdFromStreamEvent(event);
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
    if (typeof (unsubscribe as Promise<() => void>).then === "function") {
      void (unsubscribe as Promise<() => void>).then((resolved) => {
        if (this.runtimeEventSubscriptionsByRuntimeId.get(runtimeId) !== pump) {
          resolved();
          return;
        }
        pump.unsubscribe = resolved;
      });
    } else {
      pump.unsubscribe = unsubscribe as () => void;
    }
  }

  private stopRuntimeEventSubscription(runtimeId: string): void {
    const pump = this.runtimeEventSubscriptionsByRuntimeId.get(runtimeId);
    if (!pump) {
      return;
    }
    pump.unsubscribe?.();
    this.runtimeEventSubscriptionsByRuntimeId.delete(runtimeId);
  }

  private async handleRuntimeStreamEvent(event: {
    runtimeId: string;
    kind: "notification" | "server_request";
    message: unknown;
  }): Promise<void> {
    const threadId = this.threadIdFromStreamEvent(event);
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

  private threadIdFromStreamEvent(event: {
    kind: "notification" | "server_request";
    message: unknown;
  }): string | null {
    if (!isPlainObject(event.message)) {
      return null;
    }
    return extractThreadIdFromParams(event.message.params);
  }

  private bufferRuntimeStreamEvent(
    threadId: string,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): void {
    if (event.kind === "notification") {
      const notification = parseNotificationRecord(event.message);
      this.clearHistoryOnlyIdleThreadLoadForNotification(threadId, notification);
      const buffered = this.bufferedNotificationsByThreadId.get(threadId) ?? [];
      buffered.push(notification);
      if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
        buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
      }
      this.bufferedNotificationsByThreadId.set(threadId, buffered);
      trimOldestMapKeys(this.bufferedNotificationsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
      return;
    }
    this.clearHistoryOnlyIdleThreadLoad(threadId);
    const buffered = this.bufferedServerRequestsByThreadId.get(threadId) ?? [];
    buffered.push(parseServerRequestRecord(event.message));
    if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.bufferedServerRequestsByThreadId.set(threadId, buffered);
    trimOldestMapKeys(this.bufferedServerRequestsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
  }

  private clearHistoryOnlyIdleThreadLoadForNotification(
    threadId: string,
    notification: CodexNotificationRecord,
  ): void {
    if (!this.historyOnlyIdleThreadLoadsById.has(threadId)) {
      return;
    }
    if (notification.method === "turn/started") {
      this.clearHistoryOnlyIdleThreadLoad(threadId);
      return;
    }
    if (notification.method !== "thread/status/changed" || !isPlainObject(notification.params)) {
      return;
    }
    if (codexThreadStatusSnapshot(notification.params.status).classification !== "idle") {
      this.clearHistoryOnlyIdleThreadLoad(threadId);
    }
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
    const bufferedRequests = this.bufferedServerRequestsByThreadId.get(session.threadId) ?? [];
    this.bufferedServerRequestsByThreadId.delete(session.threadId);
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
    for (const approval of this.pendingApprovalsForSession(externalSessionId)) {
      this.activeTurnsByApprovalRequestId.set(approval.requestId, activeTurn);
    }
    for (const question of this.pendingQuestionsForSession(externalSessionId)) {
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
      bufferedNotificationsByThreadId: this.bufferedNotificationsByThreadId,
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
      bufferNotification: (notification) => this.bufferNotification(notification),
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

  private rememberHistoryOnlyIdleThreadLoad(
    input: LoadAgentSessionHistoryInput,
    thread: CodexThreadSnapshot,
  ): void {
    if (thread.status.agentSessionStatus !== "idle") {
      this.clearHistoryOnlyIdleThreadLoad(thread.id);
      return;
    }
    this.historyOnlyIdleThreadLoadsById.set(thread.id, {
      repoPath: input.repoPath,
      workingDirectory: input.workingDirectory,
    });
  }

  private clearHistoryOnlyIdleThreadLoad(threadId: string): void {
    this.historyOnlyIdleThreadLoadsById.delete(threadId);
  }

  private clearUnloadedHistoryOnlyIdleLoads(inventory: CodexThreadInventory): void {
    for (const threadId of this.historyOnlyIdleThreadLoadsById.keys()) {
      if (!inventory.loadedIds.has(threadId)) {
        this.clearHistoryOnlyIdleThreadLoad(threadId);
      }
    }
  }

  private threadSnapshotForRemotePresence(
    thread: CodexThreadSnapshot,
    repoPath: string,
  ): CodexThreadSnapshot {
    const historyOnlyLoad = this.historyOnlyIdleThreadLoadsById.get(thread.id);
    if (
      !historyOnlyLoad ||
      historyOnlyLoad.repoPath !== repoPath ||
      historyOnlyLoad.workingDirectory !== thread.cwd
    ) {
      return thread;
    }
    if (thread.status.classification !== "running") {
      if (thread.status.classification !== "idle") {
        this.clearHistoryOnlyIdleThreadLoad(thread.id);
      }
      return thread;
    }
    return {
      ...thread,
      status: {
        classification: IDLE_CODEX_THREAD_STATUS.classification,
        status: { ...IDLE_CODEX_THREAD_STATUS.status },
        agentSessionStatus: IDLE_CODEX_THREAD_STATUS.agentSessionStatus,
      },
    };
  }

  private pendingApprovalsForSession(
    externalSessionId: string,
  ): import("@openducktor/core").AgentPendingApprovalRequest[] {
    const requestIds = this.pendingApprovalIdsBySessionId.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestId) => this.pendingApprovalsByRequestId.get(requestId)?.request)
      .filter((request): request is import("@openducktor/core").AgentPendingApprovalRequest =>
        Boolean(request),
      );
  }

  private pendingQuestionsForSession(
    externalSessionId: string,
  ): import("@openducktor/core").AgentPendingQuestionRequest[] {
    const requestIds = this.pendingQuestionIdsBySessionId.get(externalSessionId);
    if (!requestIds) {
      return [];
    }
    return [...requestIds]
      .map((requestId) => this.pendingQuestionsByRequestId.get(requestId)?.request)
      .filter((request): request is import("@openducktor/core").AgentPendingQuestionRequest =>
        Boolean(request),
      );
  }

  private toPresenceSnapshot(session: CodexSessionState): AgentSessionPresenceSnapshot {
    return buildPresenceSnapshot(
      session,
      this.pendingApprovalsForSession(session.threadId),
      this.pendingQuestionsForSession(session.threadId),
    );
  }

  private toRefreshedPresenceSnapshot(
    session: CodexSessionState,
    inventory: CodexThreadInventory,
    input?: ReadSessionPresenceInput,
  ): AgentSessionPresenceSnapshot {
    const thread = inventory.threadsById.get(session.threadId) ?? null;
    if (!thread || !inventory.loadedIds.has(session.threadId)) {
      if (this.hasLocalRuntimePresence(session)) {
        return this.toPresenceSnapshot(session);
      }
      return stalePresence(input ?? this.sessionRef(session), session.runtimeId);
    }
    if (thread.cwd !== session.workingDirectory) {
      return stalePresence(input ?? this.sessionRef(session), session.runtimeId);
    }
    const activeTurn = this.activeTurnsBySessionId.get(session.threadId);
    const hasPendingInput =
      this.pendingApprovalsForSession(session.threadId).length > 0 ||
      this.pendingQuestionsForSession(session.threadId).length > 0;
    if (
      session.liveStatus?.agentSessionStatus === "idle" &&
      thread.status.agentSessionStatus === "running" &&
      !hasPendingInput &&
      (!activeTurn || activeTurn.isTurnSettled())
    ) {
      return this.toPresenceSnapshot(session);
    }
    this.setSessionLiveStatus(session, thread.status);
    return this.toPresenceSnapshot(session);
  }

  private hasLocalRuntimePresence(session: CodexSessionState): boolean {
    if (this.pendingApprovalsForSession(session.threadId).length > 0) {
      return true;
    }
    if (this.pendingQuestionsForSession(session.threadId).length > 0) {
      return true;
    }
    const activeTurn = this.activeTurnsBySessionId.get(session.threadId);
    if (activeTurn && !activeTurn.isTurnSettled()) {
      return true;
    }
    return (
      session.liveStatus?.agentSessionStatus === "idle" || session.summary.status === "running"
    );
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

  private sessionRef(session: CodexSessionState): ReadSessionPresenceInput {
    return {
      externalSessionId: session.threadId,
      repoPath: session.repoPath,
      runtimeKind: "codex",
      workingDirectory: session.workingDirectory,
    };
  }

  private async readRemoteSessionPresence(
    input: ReadSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot> {
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "read session presence",
      {
        requireLive: true,
      },
    );
    const inventory = await this.threadInventory.refresh(client, runtimeId);
    this.clearUnloadedHistoryOnlyIdleLoads(inventory);
    if (!inventory.loadedIds.has(input.externalSessionId)) {
      return stalePresence(input, runtimeId);
    }
    const snapshot = inventory.threadsById.get(input.externalSessionId) ?? null;
    if (!snapshot || snapshot.cwd !== input.workingDirectory) {
      return stalePresence(input, runtimeId);
    }
    return toPresenceSnapshotFromThread(
      this.threadSnapshotForRemotePresence(snapshot, input.repoPath),
      input,
      runtimeId,
    );
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
