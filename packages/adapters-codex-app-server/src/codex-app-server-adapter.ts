import { CODEX_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionPort,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  AgentWorkspaceInspectionPort,
  AttachAgentSessionInput,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
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
  RepoRuntimeRef,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";
import { createCodexAppServerClient } from "./app-server-client";
import {
  codexTurnKey,
  extractThreadIdFromParams,
  extractTurnId,
  isMutatingCodexRequest,
  isTerminalTurnStatus,
  parseNotificationRecord,
  parseQuestionRequest,
  parseServerRequestRecord,
  READ_ONLY_ROLES,
  toApprovalRequest,
} from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  arrayFromUnknown,
  type CachedCodexModelList,
  CODEX_MODEL_CATALOG_TTL_MS,
  CODEX_USER_INPUT_REQUEST_METHOD,
  type CodexLiveEventPump,
  extractStringField,
  isCodexThreadNotLoadedError,
  isCodexUnmaterializedThreadError,
  isPlainObject,
  MAX_CODEX_BUFFERED_THREAD_COUNT,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
  trimOldestMapKeys,
  unsupported,
} from "./codex-app-server-shared";
import {
  type CodexThreadInventory,
  type CodexThreadSnapshot,
  codexLoadedThreadIds,
  codexThreadList,
  codexThreadStatusSnapshot,
  extractThreadId,
  threadSnapshotFromReadResponse,
  toSessionSummary,
} from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexItemId,
  codexItemTypeMatches,
  codexTodosFromThreadRead,
  codexTurnItemsFromThreadRead,
  codexUserInputListToText,
  codexUserInputsFromItem,
  codexUserInputToDisplayPart,
  extractCodexTokenUsageTotals,
  shouldReplaceCodexBufferedFinalAgentMessage,
  timestampFromCodexParams,
  toCodexUserInputList,
  toDisplayParts,
  toFileDiffs,
  toHistoryMessage,
  toStreamPart,
} from "./codex-app-server-transcript";
import type { CodexCanonicalEvent } from "./codex-canonical-events";
import {
  latestTodosFromCanonicalEvents,
  projectCodexCanonicalEvents,
} from "./codex-canonical-projector";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";
import {
  requireModelSelection,
  toCatalog,
  toTransportModelSelection,
  validateModelSelection,
} from "./model-catalog";
import { resolveCodexRuntimeClientInput } from "./runtime-connection";
import type {
  CodexAppServerAdapterOptions,
  CodexAppServerClient,
  CodexModelListResponse,
  CodexNotificationRecord,
  CodexServerRequestRecord,
  CodexSessionState,
} from "./types";

export { createCodexAppServerClient } from "./app-server-client";

export class CodexAppServerAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly sessions = new Map<string, CodexSessionState>();
  private readonly clientsByRuntimeId = new Map<string, CodexAppServerClient>();
  private readonly listenersBySessionId = new Map<
    string,
    Set<(event: import("@openducktor/core").AgentEvent) => void>
  >();
  private readonly pendingApprovalsByRequestId = new Map<
    string,
    { runtimeId: string; request: import("@openducktor/core").AgentPendingApprovalRequest }
  >();
  private readonly pendingApprovalIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingQuestionsByRequestId = new Map<
    string,
    {
      runtimeId: string;
      threadId: string;
      request: import("@openducktor/core").AgentPendingQuestionRequest;
      questionIds: string[];
      input: Record<string, unknown>;
    }
  >();
  private readonly pendingQuestionIdsBySessionId = new Map<string, Set<string>>();
  private readonly activeTurnsByApprovalRequestId = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsByQuestionRequestId = new Map<string, ActiveCodexTurn>();
  private readonly activeTurnsBySessionId = new Map<string, ActiveCodexTurn>();
  private readonly bufferedNotificationsByThreadId = new Map<string, CodexNotificationRecord[]>();
  private readonly bufferedServerRequestsByThreadId = new Map<string, CodexServerRequestRecord[]>();
  private readonly handledStreamRequestKeysByThreadId = new Map<string, Set<string>>();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<
    string,
    { session: CodexSessionState; item: Record<string, unknown>; timestamp: string }
  >();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly runtimeEventSubscriptionsByRuntimeId = new Map<string, CodexLiveEventPump>();
  private readonly eventBacklogBySessionId = new Map<string, AgentEvent[]>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly eventMapperPipeline = createCodexEventMapperPipeline();
  private readonly modelListCacheByRuntimeId = new Map<string, CachedCodexModelList>();
  private readonly threadInventoryByRuntimeId = new Map<string, CodexThreadInventory>();
  private readonly pendingThreadInventoryByRuntimeId = new Map<
    string,
    Promise<CodexThreadInventory>
  >();

  constructor(private readonly options: CodexAppServerAdapterOptions) {}

  getRuntimeDefinition(): RuntimeDescriptor {
    return CODEX_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "list available models", {
      requireLive: true,
    });
    return toCatalog(await this.cachedModelList(client, runtimeId));
  }

  private async cachedModelList(
    client: CodexAppServerClient,
    runtimeId: string,
  ): Promise<CodexModelListResponse> {
    const now = Date.now();
    const cached = this.modelListCacheByRuntimeId.get(runtimeId);
    if (
      cached?.value &&
      typeof cached.fetchedAtMs === "number" &&
      now - cached.fetchedAtMs < CODEX_MODEL_CATALOG_TTL_MS
    ) {
      return cached.value;
    }
    if (cached?.pending) {
      return cached.pending;
    }
    const pending = client.modelList().then(
      (value) => {
        this.modelListCacheByRuntimeId.set(runtimeId, { value, fetchedAtMs: Date.now() });
        return value;
      },
      (error) => {
        this.modelListCacheByRuntimeId.delete(runtimeId);
        throw error;
      },
    );
    this.modelListCacheByRuntimeId.set(runtimeId, {
      ...(cached?.value ? { value: cached.value, fetchedAtMs: cached.fetchedAtMs } : {}),
      pending,
    });
    return pending;
  }

  private async validateCachedModelSelection(
    client: CodexAppServerClient,
    runtimeId: string,
    model: AgentModelSelection,
  ): Promise<void> {
    validateModelSelection(await this.cachedModelList(client, runtimeId), model);
  }

  private clearThreadInventory(runtimeId: string): void {
    this.threadInventoryByRuntimeId.delete(runtimeId);
    this.pendingThreadInventoryByRuntimeId.delete(runtimeId);
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "start session");
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.validateCachedModelSelection(client, runtimeId, model);

    const response = await client.threadStart({
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const { externalSessionId, startedAt } = extractThreadId(response, "thread/start");

    const summary = toSessionSummary({
      externalSessionId,
      startedAt: startedAt ?? new Date().toISOString(),
      role: input.role,
    });

    this.sessions.set(summary.externalSessionId, {
      summary,
      model,
      systemPrompt: input.systemPrompt,
      role: input.role,
      runtimeId,
      repoPath: input.repoPath,
      threadId: externalSessionId,
      workingDirectory: input.workingDirectory,
      taskId: input.taskId,
    });
    void this.drainBufferedStreamEvents(summary.externalSessionId);

    return summary;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "resume session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.validateCachedModelSelection(client, runtimeId, model);

    const response = await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const { externalSessionId, startedAt } = extractThreadId(response, "thread/resume");
    const threadSnapshot = threadSnapshotFromReadResponse(response);

    const summary = toSessionSummary({
      externalSessionId,
      startedAt: startedAt ?? threadSnapshot?.startedAt ?? new Date().toISOString(),
      role: input.role,
    });
    const liveStatus = threadSnapshot?.status;

    this.sessions.set(summary.externalSessionId, {
      summary,
      model,
      systemPrompt: input.systemPrompt,
      role: input.role,
      runtimeId,
      repoPath: input.repoPath,
      threadId: externalSessionId,
      workingDirectory: input.workingDirectory,
      taskId: input.taskId,
      ...(liveStatus ? { liveStatus } : {}),
    });
    void this.drainBufferedStreamEvents(summary.externalSessionId);

    return summary;
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "fork session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    await this.validateCachedModelSelection(client, runtimeId, model);

    const response = await client.threadFork({
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const { externalSessionId, startedAt } = extractThreadId(response, "thread/fork");

    const summary = toSessionSummary({
      externalSessionId,
      startedAt: startedAt ?? new Date().toISOString(),
      role: input.role,
    });

    this.sessions.set(summary.externalSessionId, {
      summary,
      model,
      systemPrompt: input.systemPrompt,
      role: input.role,
      runtimeId,
      repoPath: input.repoPath,
      threadId: externalSessionId,
      workingDirectory: input.workingDirectory,
      taskId: input.taskId,
    });
    void this.drainBufferedStreamEvents(summary.externalSessionId);

    return summary;
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    await this.startTurnForSession(input.externalSessionId, input.parts, input.model);
  }

  private async steerActiveTurn(
    activeTurn: ActiveCodexTurn,
    parts: import("@openducktor/core").AgentUserMessagePart[],
  ): Promise<boolean> {
    const input = toCodexUserInputList(parts);
    if (!activeTurn.turnId && !this.options.subscribeEvents) {
      await this.handlePendingServerRequests(activeTurn.session, activeTurn.handledRequestKeys);
    }
    if (activeTurn.isTurnSettled()) {
      return false;
    }
    if (!activeTurn.turnId) {
      activeTurn.queuedUserMessages.push(input);
      return true;
    }
    await this.clientForRuntime(activeTurn.session.runtimeId).turnSteer({
      threadId: activeTurn.session.threadId,
      input,
      expectedTurnId: activeTurn.turnId,
    });
    return true;
  }

  private async flushQueuedUserMessages(activeTurn: ActiveCodexTurn): Promise<void> {
    if (!activeTurn.turnId) {
      return;
    }
    while (activeTurn.queuedUserMessages.length > 0) {
      const queued = activeTurn.queuedUserMessages.shift();
      if (!queued) {
        continue;
      }
      await this.clientForRuntime(activeTurn.session.runtimeId).turnSteer({
        threadId: activeTurn.session.threadId,
        input: queued,
        expectedTurnId: activeTurn.turnId,
      });
    }
  }

  private async startTurnForSession(
    externalSessionId: string,
    parts: import("@openducktor/core").AgentUserMessagePart[],
    requestedModel?: AgentModelSelection,
  ): Promise<void> {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${externalSessionId}'.`);
    }
    this.ensureRuntimeEventSubscription(session.runtimeId);
    const input = toCodexUserInputList(parts);

    const existingActiveTurn = this.activeTurnsBySessionId.get(session.threadId);
    if (existingActiveTurn && !existingActiveTurn.isTurnSettled()) {
      const didSteer = await this.steerActiveTurn(existingActiveTurn, parts);
      if (!didSteer) {
        await this.startTurnForSession(externalSessionId, parts, requestedModel);
      }
      return;
    }

    let turnSettled = false;
    const handledRequestKeys = new Set<string>();
    const activeTurnState: ActiveCodexTurn = {
      session,
      turnStartPromise: Promise.resolve({}),
      isTurnSettled: () => turnSettled,
      markTurnSettled: () => {
        turnSettled = true;
        this.activeTurnsBySessionId.delete(session.threadId);
      },
      handledRequestKeys,
      queuedUserMessages: [],
    };
    this.activeTurnsBySessionId.set(session.threadId, activeTurnState);

    const model = requireModelSelection(requestedModel ?? session.model);
    const client = this.clientForRuntime(session.runtimeId);
    try {
      await this.validateCachedModelSelection(client, session.runtimeId, model);
    } catch (error) {
      turnSettled = true;
      this.activeTurnsBySessionId.delete(session.threadId);
      throw error;
    }

    const turnStartPromise = client
      .turnStart({
        threadId: session.threadId,
        input,
        model: toTransportModelSelection(model).model,
        effort: toTransportModelSelection(model).effort,
      })
      .then((result) => {
        const turnId = extractTurnId(result);
        if (turnId) {
          activeTurnState.turnId = turnId;
        }
        void this.flushQueuedUserMessages(activeTurnState).catch((error) => {
          this.emitSessionEvent(session.threadId, {
            type: "session_error",
            externalSessionId: session.threadId,
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          });
        });
        if (!this.options.subscribeEvents && !this.options.drainNotifications) {
          this.emitUserMessage(session, parts);
          activeTurnState.markTurnSettled();
        } else if (isPlainObject(result.turn) && isTerminalTurnStatus(result.turn)) {
          activeTurnState.markTurnSettled();
        }
        return result;
      })
      .catch((error) => {
        activeTurnState.markTurnSettled();
        throw error;
      });
    activeTurnState.turnStartPromise = turnStartPromise;

    if (this.options.subscribeEvents) {
      this.emitUserMessage(session, parts);
      void turnStartPromise.catch((error) => {
        this.emitSessionEvent(session.threadId, {
          type: "session_error",
          externalSessionId: session.threadId,
          timestamp: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    const hasPendingInput = await this.handlePendingServerRequests(session, handledRequestKeys);
    if (hasPendingInput && !turnSettled) {
      this.bindPendingInputToActiveTurn(session.threadId, activeTurnState);
      void turnStartPromise.catch((error) => {
        this.emitSessionEvent(session.threadId, {
          type: "session_error",
          externalSessionId: session.threadId,
          timestamp: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    await turnStartPromise;
  }

  hasSession(externalSessionId: string): boolean {
    return this.sessions.has(externalSessionId);
  }

  async listAvailableSlashCommands(_: ListAgentSlashCommandsInput) {
    return unsupported("listAvailableSlashCommands");
  }

  async searchFiles(
    _: import("@openducktor/core").SearchAgentFilesInput,
  ): Promise<AgentFileSearchResult[]> {
    return unsupported("searchFiles");
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<import("@openducktor/core").AgentSessionHistoryMessage[]> {
    const session = this.sessions.get(input.externalSessionId);
    const { client, runtimeId } = session
      ? { client: this.clientForRuntime(session.runtimeId), runtimeId: session.runtimeId }
      : await this.resolveRuntimeClient(input, "load Codex session history");
    const responseWithoutTurns = await this.readLoadedThread(client, runtimeId, input);
    if (!responseWithoutTurns) {
      return [];
    }
    const response = await this.readThreadWithTurns(client, input.externalSessionId);
    return codexTurnItemsFromThreadRead(response)
      .flatMap(({ item, timestamp, isFinalAgentMessage, turnTiming }, index) => {
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
          const history = projectCodexCanonicalEventsToHistory(canonicalEvents, session?.model);
          if (isFinalAgentMessage && typeof turnTiming?.durationMs === "number") {
            return history.map((message) =>
              message.role === "assistant" &&
              message.parts.some(
                (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
              )
                ? { ...message, durationMs: turnTiming.durationMs }
                : message,
            );
          }
          return history;
        }
        const message = toHistoryMessage(
          item,
          `codex-history-${index}`,
          session?.model,
          timestamp,
          isFinalAgentMessage,
          turnTiming,
        );
        return message ? [message] : [];
      })
      .filter((message): message is import("@openducktor/core").AgentSessionHistoryMessage =>
        Boolean(message),
      );
  }

  private async readLoadedThread(
    client: CodexAppServerClient,
    runtimeId: string,
    input: LoadAgentSessionHistoryInput,
  ): Promise<unknown | null> {
    const thread = await this.findThread(client, runtimeId, input.externalSessionId);
    if (!thread || thread.cwd !== input.workingDirectory) {
      return null;
    }
    if (thread.status.status.type === "idle") {
      try {
        return await client.threadRead({
          threadId: input.externalSessionId,
          includeTurns: false,
        });
      } catch (error) {
        if (!isCodexThreadNotLoadedError(error)) {
          throw error;
        }
      }
    }
    await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
    });
    this.clearThreadInventory(runtimeId);
    return client.threadRead({
      threadId: input.externalSessionId,
      includeTurns: false,
    });
  }

  private async findThread(
    client: CodexAppServerClient,
    runtimeId: string,
    externalSessionId: string,
  ): Promise<CodexThreadSnapshot | null> {
    return (
      (await this.readThreadInventory(client, runtimeId)).threadsById.get(externalSessionId) ?? null
    );
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    const liveTodos = this.latestTodosBySessionId.get(input.externalSessionId);
    if (liveTodos) {
      return liveTodos;
    }
    const session = this.sessions.get(input.externalSessionId);
    const { client, runtimeId } = session
      ? { client: this.clientForRuntime(session.runtimeId), runtimeId: session.runtimeId }
      : await this.resolveRuntimeClient(input, "load Codex session todos");
    const responseWithoutTurns = await this.readLoadedThread(client, runtimeId, input);
    if (!responseWithoutTurns) {
      return [];
    }
    const response = await this.readThreadWithTurns(client, input.externalSessionId);
    const todos = codexTodosFromThreadRead(response);
    if (todos.length > 0) {
      this.latestTodosBySessionId.set(input.externalSessionId, todos);
    }
    return todos;
  }

  private async readThreadWithTurns(
    client: CodexAppServerClient,
    threadId: string,
  ): Promise<unknown> {
    let response: unknown;
    try {
      response = await client.threadRead({ threadId, includeTurns: true });
    } catch (error) {
      if (isCodexUnmaterializedThreadError(error)) {
        return { thread: { id: threadId, turns: [] } };
      }
      throw error;
    }
    const pagedTurns = await this.fetchThreadTurns(client, threadId);
    if (pagedTurns.length === 0) {
      return response;
    }
    if (!isPlainObject(response) || !isPlainObject(response.thread)) {
      return { thread: { id: threadId, turns: pagedTurns } };
    }
    return { ...response, thread: { ...response.thread, turns: pagedTurns } };
  }

  private async fetchThreadTurns(
    client: CodexAppServerClient,
    threadId: string,
  ): Promise<Record<string, unknown>[]> {
    const turns: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadTurnsList({
        threadId,
        cursor,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
      });
      turns.push(...arrayFromUnknown(response).filter(isPlainObject));
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/turns/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return turns;
  }

  updateSessionModel(_: UpdateAgentSessionModelInput): void {
    unsupported("updateSessionModel");
  }

  async attachSession(input: AttachAgentSessionInput): Promise<AgentSessionSummary> {
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "attach session", {
      requireLive: true,
    });
    this.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? input.model : undefined;
    if (model) {
      await this.validateCachedModelSelection(client, runtimeId, model);
    }

    const response = await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
      ...(model ? { model: toTransportModelSelection(model).model } : {}),
      ...(model ? { effort: toTransportModelSelection(model).effort } : {}),
    });
    const { externalSessionId, startedAt } = extractThreadId(response, "thread/resume");
    const threadSnapshot = threadSnapshotFromReadResponse(response);
    const summary = toSessionSummary({
      externalSessionId,
      startedAt: startedAt ?? threadSnapshot?.startedAt ?? new Date().toISOString(),
      role: input.role,
    });
    const liveStatus = threadSnapshot?.status;
    const sessionState: CodexSessionState = {
      summary,
      ...(model ? { model } : {}),
      systemPrompt: input.systemPrompt,
      role: input.role,
      runtimeId,
      repoPath: input.repoPath,
      threadId: externalSessionId,
      workingDirectory: input.workingDirectory,
      taskId: input.taskId,
      ...(liveStatus ? { liveStatus } : {}),
    };
    this.sessions.set(summary.externalSessionId, sessionState);
    void this.drainBufferedStreamEvents(summary.externalSessionId);
    return summary;
  }

  async detachSession(_: string): Promise<void> {
    return unsupported("detachSession");
  }

  async listLiveAgentSessions(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSummary[]> {
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "list live sessions", {
      requireLive: true,
    });
    const inventory = await this.readThreadInventory(client, runtimeId);
    if (inventory.loadedIds.size === 0) {
      return [];
    }
    const directories = new Set(input.directories ?? []);
    return [...inventory.threadsById.values()]
      .filter((thread) => inventory.loadedIds.has(thread.id))
      .filter((thread) => directories.size === 0 || directories.has(thread.cwd))
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
    const localSnapshots = [...this.sessions.values()]
      .filter((session) => session.repoPath === input.repoPath)
      .map((session) => this.toPresenceSnapshot(session));
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "list session presence", {
      requireLive: true,
    });
    const inventory = await this.readThreadInventory(client, runtimeId);
    const directories = new Set(input.directories ?? []);
    const remoteSnapshots = [...inventory.threadsById.values()]
      .filter((thread) => inventory.loadedIds.has(thread.id))
      .filter((thread) => !this.sessions.has(thread.id))
      .filter((thread) => directories.size === 0 || directories.has(thread.cwd))
      .map((thread) => this.toPresenceSnapshotFromThread(thread, input, runtimeId));
    return [...localSnapshots, ...remoteSnapshots];
  }

  async readSessionPresence(
    input: ReadSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      return this.readRemoteSessionPresence(input);
    }
    return this.toPresenceSnapshot(session);
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
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
      Number(input.requestId),
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
    await this.options.respondServerRequest(
      pending.runtimeId,
      Number(input.requestId),
      { answers },
      undefined,
    );
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
    this.sessions.delete(externalSessionId);
    this.bufferedNotificationsByThreadId.delete(externalSessionId);
    this.bufferedServerRequestsByThreadId.delete(externalSessionId);
    this.handledStreamRequestKeysByThreadId.delete(externalSessionId);
    this.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
    this.eventBacklogBySessionId.delete(externalSessionId);
    if (
      ![...this.sessions.values()].some((candidate) => candidate.runtimeId === session.runtimeId)
    ) {
      this.stopRuntimeEventSubscription(session.runtimeId);
    }
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
      const buffered = this.bufferedNotificationsByThreadId.get(threadId) ?? [];
      buffered.push(parseNotificationRecord(event.message));
      if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
        buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
      }
      this.bufferedNotificationsByThreadId.set(threadId, buffered);
      trimOldestMapKeys(this.bufferedNotificationsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
      return;
    }
    const buffered = this.bufferedServerRequestsByThreadId.get(threadId) ?? [];
    buffered.push(parseServerRequestRecord(event.message));
    if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.bufferedServerRequestsByThreadId.set(threadId, buffered);
    trimOldestMapKeys(this.bufferedServerRequestsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
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
    const bufferedNotifications = this.bufferedNotificationsByThreadId.get(session.threadId) ?? [];
    this.bufferedNotificationsByThreadId.delete(session.threadId);
    const drainedNotifications = notificationsFromBatch
      ? notificationsFromBatch.map(parseNotificationRecord)
      : this.options.drainNotifications
        ? (await this.options.drainNotifications(session.runtimeId)).map(parseNotificationRecord)
        : [];
    const notifications = [...bufferedNotifications, ...drainedNotifications];
    for (const notification of notifications) {
      const notificationThreadId = extractThreadIdFromParams(notification.params);
      if (notificationThreadId && notificationThreadId !== session.threadId) {
        const buffered = this.bufferedNotificationsByThreadId.get(notificationThreadId) ?? [];
        buffered.push(notification);
        if (buffered.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
          buffered.splice(0, buffered.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
        }
        this.bufferedNotificationsByThreadId.set(notificationThreadId, buffered);
        trimOldestMapKeys(this.bufferedNotificationsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
        continue;
      }
      const timestamp = timestampFromCodexParams(notification.params);
      const notificationTurnId = extractTurnId(notification.params);
      const activeTurn = this.activeTurnsBySessionId.get(session.threadId);
      if (notificationTurnId && activeTurn && !activeTurn.turnId) {
        activeTurn.turnId = notificationTurnId;
        void this.flushQueuedUserMessages(activeTurn).catch((error) => {
          this.emitSessionEvent(session.threadId, {
            type: "session_error",
            externalSessionId: session.threadId,
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }

      if (notification.method === "turn/started") {
        session.liveStatus = {
          classification: "running",
          status: { type: "busy" },
          agentSessionStatus: "running",
        };
        const turn = isPlainObject(notification.params) ? notification.params.turn : null;
        const turnId = isPlainObject(turn) ? extractStringField(turn, ["id", "turnId"]) : null;
        if (turnId && activeTurn && !activeTurn.turnId) {
          activeTurn.turnId = turnId;
        }
        continue;
      }

      if (notification.method === "thread/status/changed") {
        if (isPlainObject(notification.params)) {
          session.liveStatus = codexThreadStatusSnapshot(notification.params.status);
        }
        continue;
      }

      if (notification.method === "thread/tokenUsage/updated") {
        const tokenUsage = extractCodexTokenUsageTotals(notification.params);
        const usageTurnId = notificationTurnId ?? activeTurn?.turnId ?? session.threadId;
        if (tokenUsage) {
          this.tokenUsageByTurnKey.set(codexTurnKey(session.threadId, usageTurnId), tokenUsage);
          this.emitCanonicalEvents(
            this.eventMapperPipeline.runLive(
              { kind: "notification", notification },
              { source: "live", threadId: session.threadId, turnId: usageTurnId, timestamp },
            ),
          );
        }
        continue;
      }

      if (notification.method === "turn/plan/updated") {
        if (isPlainObject(notification.params)) {
          const todoTurnId = notificationTurnId ?? activeTurn?.turnId ?? session.threadId;
          this.emitCanonicalEvents(
            this.eventMapperPipeline.runLive(
              { kind: "notification", notification },
              {
                source: "live",
                threadId: session.threadId,
                turnId: todoTurnId,
                timestamp,
              },
            ),
          );
        }
        continue;
      }

      if (notification.method !== "turn/completed") {
        const canonicalEvents = this.eventMapperPipeline.runLive(
          { kind: "notification", notification },
          {
            source: "live",
            threadId: session.threadId,
            ...(notificationTurnId ? { turnId: notificationTurnId } : {}),
            timestamp,
          },
        );
        if (canonicalEvents.length > 0) {
          this.emitCanonicalEvents(canonicalEvents);
          continue;
        }
      }

      if (notification.method === "turn/completed") {
        const turn = isPlainObject(notification.params) ? notification.params.turn : null;
        const turnId = isPlainObject(turn) ? extractStringField(turn, ["id", "turnId"]) : null;
        if (turnId && isPlainObject(turn) && turn.status === "completed") {
          const bufferedAgentMessage = this.completedAgentMessagesByTurnKey.get(
            codexTurnKey(session.threadId, turnId),
          );
          if (bufferedAgentMessage) {
            this.emitFinalAgentMessage(
              bufferedAgentMessage.session,
              bufferedAgentMessage.item,
              bufferedAgentMessage.timestamp,
              this.tokenUsageByTurnKey.get(codexTurnKey(session.threadId, turnId)),
            );
            this.completedAgentMessagesByTurnKey.delete(codexTurnKey(session.threadId, turnId));
          }
          this.tokenUsageByTurnKey.delete(codexTurnKey(session.threadId, turnId));
        } else if (turnId) {
          this.completedAgentMessagesByTurnKey.delete(codexTurnKey(session.threadId, turnId));
          this.tokenUsageByTurnKey.delete(codexTurnKey(session.threadId, turnId));
        }
        activeTurn?.markTurnSettled();
        session.liveStatus = {
          classification: "idle",
          status: { type: "idle" },
          agentSessionStatus: "idle",
        };
        this.emitCanonicalEvents(
          this.eventMapperPipeline.runLive(
            { kind: "notification", notification },
            {
              source: "live",
              threadId: session.threadId,
              ...(turnId ? { turnId } : {}),
              timestamp,
            },
          ),
        );
        continue;
      }

      if (notification.method === "item/agentMessage/delta") {
        const delta = extractStringField(notification.params, ["delta"]);
        if (delta) {
          const messageId = extractStringField(notification.params, ["itemId", "item_id"]);
          this.emitSessionEvent(session.threadId, {
            type: "assistant_delta",
            externalSessionId: session.threadId,
            timestamp,
            channel: "text",
            ...(messageId ? { messageId } : {}),
            delta,
          });
        }
        continue;
      }

      if (
        notification.method === "item/reasoningText/delta" ||
        notification.method === "item/reasoningSummaryText/delta" ||
        notification.method === "item/reasoning/textDelta" ||
        notification.method === "item/reasoning/summaryTextDelta"
      ) {
        const delta = extractStringField(notification.params, ["delta"]);
        if (delta) {
          const messageId = extractStringField(notification.params, ["itemId", "item_id"]);
          this.emitSessionEvent(session.threadId, {
            type: "assistant_delta",
            externalSessionId: session.threadId,
            timestamp,
            channel: "reasoning",
            ...(messageId ? { messageId } : {}),
            delta,
          });
        }
        continue;
      }

      if (notification.method === "item/started") {
        const item = isPlainObject(notification.params) ? notification.params.item : null;
        if (isPlainObject(item)) {
          this.emitStartedItem(session, item, timestamp);
        }
        continue;
      }

      if (notification.method === "item/completed") {
        const item = isPlainObject(notification.params) ? notification.params.item : null;
        if (isPlainObject(item)) {
          this.emitCompletedItem(session, item, timestamp, notificationTurnId);
        }
      }
    }
  }

  private async readThreadInventory(
    client: CodexAppServerClient,
    runtimeId: string,
  ): Promise<CodexThreadInventory> {
    const existing = this.threadInventoryByRuntimeId.get(runtimeId);
    if (existing) {
      return existing;
    }
    const pending = this.pendingThreadInventoryByRuntimeId.get(runtimeId);
    if (pending) {
      return pending;
    }
    const nextPending = this.fetchThreadInventory(client, runtimeId).then(
      (inventory) => {
        this.threadInventoryByRuntimeId.set(runtimeId, inventory);
        this.pendingThreadInventoryByRuntimeId.delete(runtimeId);
        return inventory;
      },
      (error) => {
        this.pendingThreadInventoryByRuntimeId.delete(runtimeId);
        throw error;
      },
    );
    this.pendingThreadInventoryByRuntimeId.set(runtimeId, nextPending);
    return nextPending;
  }

  private async fetchThreadInventory(
    client: CodexAppServerClient,
    runtimeId: string,
  ): Promise<CodexThreadInventory> {
    const [loadedIds, threads] = await Promise.all([
      this.fetchLoadedThreadIds(client),
      this.fetchThreads(client),
    ]);
    return {
      runtimeId,
      loadedIds,
      threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    };
  }

  private async fetchLoadedThreadIds(client: CodexAppServerClient): Promise<Set<string>> {
    const loadedIds = new Set<string>();
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadLoadedList({ cursor, limit: 100 });
      const pageIds = codexLoadedThreadIds(response);
      for (const threadId of pageIds) {
        loadedIds.add(threadId);
      }
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/loaded/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return loadedIds;
  }

  private async fetchThreads(client: CodexAppServerClient): Promise<CodexThreadSnapshot[]> {
    const threads: CodexThreadSnapshot[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadList({ cursor, limit: 100 });
      threads.push(...codexThreadList(response));
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return threads;
  }

  private emitUserMessage(session: CodexSessionState, parts: AgentUserMessagePart[]): void {
    const message = serializeAgentUserMessagePartsToText(parts);
    if (this.options.subscribeEvents) {
      const codexEchoText = codexUserInputListToText(toCodexUserInputList(parts));
      const pendingTexts = this.syntheticUserMessageTextsByThreadId.get(session.threadId) ?? [];
      pendingTexts.push(codexEchoText);
      if (pendingTexts.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
        pendingTexts.splice(0, pendingTexts.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
      }
      this.syntheticUserMessageTextsByThreadId.set(session.threadId, pendingTexts);
    }
    this.emitSessionEvent(session.threadId, {
      type: "user_message",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      messageId: `codex-user-${Date.now()}`,
      message,
      parts: toDisplayParts(parts),
      state: "read",
      ...(session.model ? { model: session.model } : {}),
    });
  }

  private emitStartedItem(
    session: CodexSessionState,
    item: Record<string, unknown>,
    timestamp: string,
  ): void {
    if (
      codexItemTypeMatches(item, "userMessage") ||
      codexItemTypeMatches(item, "agentMessage") ||
      codexItemTypeMatches(item, "reasoning") ||
      codexItemTypeMatches(item, "hookPrompt")
    ) {
      return;
    }
    const canonicalEvents = this.eventMapperPipeline.runLive(
      { kind: "item_started", item },
      { source: "live", threadId: session.threadId, timestamp },
    );
    for (const event of projectCodexCanonicalEvents(canonicalEvents)) {
      if (event.type !== "assistant_part" || event.part.kind !== "tool") {
        continue;
      }
      this.emitSessionEvent(session.threadId, {
        type: "assistant_part",
        externalSessionId: session.threadId,
        timestamp,
        part: {
          ...event.part,
          status: event.part.status === "completed" ? "running" : event.part.status,
        },
      });
    }
  }

  private emitCompletedItem(
    session: CodexSessionState,
    item: Record<string, unknown>,
    timestamp: string,
    turnId: string | null,
  ): void {
    const itemId = extractStringField(item, ["id"]) ?? `codex-item-${Date.now()}`;
    if (codexItemTypeMatches(item, "userMessage")) {
      const input = codexUserInputsFromItem(item);
      const message = codexUserInputListToText(input);
      if (this.consumeSyntheticUserMessage(session.threadId, message)) {
        return;
      }
      this.emitSessionEvent(session.threadId, {
        type: "user_message",
        externalSessionId: session.threadId,
        timestamp,
        messageId: itemId,
        message,
        parts: input.map(codexUserInputToDisplayPart),
        state: "read",
        ...(session.model ? { model: session.model } : {}),
      });
      return;
    }

    if (codexItemTypeMatches(item, "hookPrompt")) {
      return;
    }

    if (codexItemTypeMatches(item, "agentMessage")) {
      const text = extractStringField(item, ["text"]);
      if (text) {
        this.emitSessionEvent(session.threadId, {
          type: "assistant_part",
          externalSessionId: session.threadId,
          timestamp,
          part: {
            kind: "text",
            messageId: itemId,
            partId: `${itemId}-text`,
            text,
            completed: true,
          },
        });
        if (turnId) {
          const turnKey = codexTurnKey(session.threadId, turnId);
          const existing = this.completedAgentMessagesByTurnKey.get(turnKey);
          if (!existing || shouldReplaceCodexBufferedFinalAgentMessage(existing.item, item)) {
            this.completedAgentMessagesByTurnKey.set(turnKey, {
              session,
              item,
              timestamp,
            });
          }
        }
      }
      return;
    }

    const canonicalEvents = this.eventMapperPipeline.runLive(
      { kind: "item_completed", item },
      {
        source: "live",
        threadId: session.threadId,
        ...(turnId ? { turnId } : {}),
        timestamp,
      },
    );
    if (canonicalEvents.length > 0) {
      this.emitCanonicalEvents(canonicalEvents);
      return;
    }

    const parts = toStreamPart(item, itemId, itemId);
    for (const part of parts) {
      this.emitSessionEvent(session.threadId, {
        type: "assistant_part",
        externalSessionId: session.threadId,
        timestamp,
        part,
      });
    }
  }

  private consumeSyntheticUserMessage(externalSessionId: string, message: string): boolean {
    const pendingTexts = this.syntheticUserMessageTextsByThreadId.get(externalSessionId);
    if (!pendingTexts || pendingTexts.length === 0) {
      return false;
    }
    const index = pendingTexts.indexOf(message);
    if (index === -1) {
      return false;
    }
    pendingTexts.splice(index, 1);
    if (pendingTexts.length === 0) {
      this.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
    }
    return true;
  }

  private emitFinalAgentMessage(
    session: CodexSessionState,
    item: Record<string, unknown>,
    timestamp: string,
    tokenUsage?: CodexTokenUsageTotals,
  ): void {
    const itemId = codexItemId(item, `codex-item-${Date.now()}`);
    const text = extractStringField(item, ["text"]);
    if (text) {
      this.emitSessionEvent(session.threadId, {
        type: "assistant_message",
        externalSessionId: session.threadId,
        timestamp,
        messageId: itemId,
        message: text,
        ...(typeof tokenUsage?.totalTokens === "number"
          ? { totalTokens: tokenUsage.totalTokens }
          : {}),
        ...(typeof tokenUsage?.contextWindow === "number"
          ? { contextWindow: tokenUsage.contextWindow }
          : {}),
        ...(session.model ? { model: session.model } : {}),
      });
    }
  }

  private emitSessionEvent(externalSessionId: string, event: AgentEvent): void {
    const listeners = this.listenersBySessionId.get(externalSessionId);
    if (!listeners) {
      this.bufferSessionEvent(externalSessionId, event);
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }

  private emitCanonicalEvents(events: CodexCanonicalEvent[]): void {
    const todos = latestTodosFromCanonicalEvents(events);
    if (todos) {
      const threadId = events.find((event) => event.kind === "todo_update")?.threadId;
      if (threadId) {
        this.latestTodosBySessionId.set(threadId, todos);
      }
    }
    for (const event of projectCodexCanonicalEvents(events)) {
      this.emitSessionEvent(event.externalSessionId, event);
    }
  }

  private bufferSessionEvent(externalSessionId: string, event: AgentEvent): void {
    if (event.type === "approval_required" || event.type === "question_required") {
      return;
    }
    const backlog = this.eventBacklogBySessionId.get(externalSessionId) ?? [];
    backlog.push(event);
    if (backlog.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      backlog.splice(0, backlog.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.eventBacklogBySessionId.set(externalSessionId, backlog);
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
    const pendingApprovals = this.pendingApprovalsForSession(session.threadId);
    const pendingQuestions = this.pendingQuestionsForSession(session.threadId);
    const hasPendingInput = pendingApprovals.length > 0 || pendingQuestions.length > 0;
    const liveStatus = session.liveStatus;
    const classification =
      pendingQuestions.length > 0
        ? "waiting_for_question"
        : pendingApprovals.length > 0
          ? "waiting_for_permission"
          : (liveStatus?.classification ?? "idle");
    return {
      presence: "runtime",
      classification,
      ref: {
        externalSessionId: session.threadId,
        repoPath: session.repoPath,
        runtimeKind: "codex",
        workingDirectory: session.workingDirectory,
      },
      runtimeId: session.runtimeId,
      title: `Codex ${session.role}`,
      startedAt: session.summary.startedAt,
      status: hasPendingInput ? { type: "busy" } : (liveStatus?.status ?? { type: "idle" }),
      agentSessionStatus: hasPendingInput ? "running" : (liveStatus?.agentSessionStatus ?? "idle"),
      pendingApprovals,
      pendingQuestions,
    };
  }

  private toPresenceSnapshotFromThread(
    thread: CodexThreadSnapshot,
    ref: RepoRuntimeRef & { workingDirectory?: string; externalSessionId?: string },
    runtimeId: string,
  ): AgentSessionPresenceSnapshot {
    return {
      presence: "runtime",
      classification: thread.status.classification,
      ref: {
        externalSessionId: ref.externalSessionId ?? thread.id,
        repoPath: ref.repoPath,
        runtimeKind: "codex",
        workingDirectory: thread.cwd,
      },
      runtimeId,
      title: thread.title,
      startedAt: thread.startedAt,
      status: thread.status.status,
      agentSessionStatus: thread.status.agentSessionStatus,
      pendingApprovals: [],
      pendingQuestions: [],
    };
  }

  private stalePresence(
    input: AgentSessionRef,
    runtimeId: string | null = null,
  ): AgentSessionPresenceSnapshot {
    return {
      presence: "stale",
      classification: "stale",
      ref: input,
      runtimeId,
      pendingApprovals: [],
      pendingQuestions: [],
    };
  }

  private async readRemoteSessionPresence(
    input: ReadSessionPresenceInput,
  ): Promise<AgentSessionPresenceSnapshot> {
    const { client, runtimeId } = await this.resolveRuntimeClient(input, "read session presence", {
      requireLive: true,
    });
    const inventory = await this.readThreadInventory(client, runtimeId);
    if (!inventory.loadedIds.has(input.externalSessionId)) {
      return this.stalePresence(input, runtimeId);
    }
    const snapshot = inventory.threadsById.get(input.externalSessionId) ?? null;
    if (!snapshot || snapshot.cwd !== input.workingDirectory) {
      return this.stalePresence(input, runtimeId);
    }
    return this.toPresenceSnapshotFromThread(snapshot, input, runtimeId);
  }

  private async handleServerRequest(
    session: CodexSessionState,
    rawRequest: CodexServerRequestRecord,
    handledRequestKeys: Set<string>,
  ): Promise<boolean> {
    const requestId = rawRequest.id;
    const requestKey = requestId !== undefined ? `request:${requestId}` : undefined;
    if (requestKey && handledRequestKeys.has(requestKey)) {
      return false;
    }

    if (requestKey) {
      handledRequestKeys.add(requestKey);
    }

    if (typeof rawRequest.method !== "string" || rawRequest.method.trim().length === 0) {
      throw new Error("Codex app-server server request is missing method.");
    }

    const requestTurnId = extractTurnId(rawRequest.params);
    const activeTurn = this.activeTurnsBySessionId.get(session.threadId);
    if (requestTurnId && activeTurn && !activeTurn.turnId) {
      activeTurn.turnId = requestTurnId;
      void this.flushQueuedUserMessages(activeTurn);
    }

    if (rawRequest.method === CODEX_USER_INPUT_REQUEST_METHOD) {
      const parsed = parseQuestionRequest(rawRequest);
      if (parsed.threadId !== session.threadId) {
        throw new Error(
          `Codex question request thread '${parsed.threadId}' does not match active session '${session.threadId}'.`,
        );
      }
      if (activeTurn && !activeTurn.turnId) {
        activeTurn.turnId = parsed.turnId;
        void this.flushQueuedUserMessages(activeTurn);
      }
      const questionInput = {
        requestId: parsed.request.requestId,
        questions: parsed.request.questions,
      };
      this.pendingQuestionsByRequestId.set(parsed.request.requestId, {
        runtimeId: session.runtimeId,
        threadId: session.threadId,
        request: parsed.request,
        questionIds: parsed.questionIds,
        input: questionInput,
      });
      const requestIds = this.pendingQuestionIdsBySessionId.get(session.threadId) ?? new Set();
      requestIds.add(parsed.request.requestId);
      this.pendingQuestionIdsBySessionId.set(session.threadId, requestIds);
      this.emitSessionEvent(session.threadId, {
        ...parsed.request,
        type: "question_required",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
      });
      this.emitSessionEvent(session.threadId, {
        type: "assistant_part",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        part: requireNormalizedCodexToolInvocation({
          messageId: `codex-question-${parsed.request.requestId}`,
          partId: `codex-question-${parsed.request.requestId}`,
          callId: parsed.request.requestId,
          rawToolName: "request_user_input",
          status: "running",
          input: questionInput,
          metadata: {
            codexServerRequest: true,
            method: rawRequest.method,
            requestId: parsed.request.requestId,
            questions: parsed.request.questions,
            questionIds: parsed.questionIds,
            turnId: parsed.turnId,
          },
        }),
      });
      return true;
    }

    if (rawRequest.method !== "item/tool/call") {
      if (requestId === undefined) {
        throw new Error(`Codex app-server server request '${rawRequest.method}' is missing an id.`);
      }
      if (session.role && READ_ONLY_ROLES.has(session.role) && isMutatingCodexRequest(rawRequest)) {
        await this.options.respondServerRequest(
          session.runtimeId,
          requestId,
          {
            approved: false,
            outcome: "reject",
            message: `Codex request '${rawRequest.method}' was rejected because role '${session.role}' is read-only.`,
          },
          undefined,
        );
        this.emitSessionEvent(session.threadId, {
          type: "session_error",
          externalSessionId: session.threadId,
          timestamp: new Date().toISOString(),
          message: `Rejected mutating Codex request '${rawRequest.method}' for read-only role '${session.role}'.`,
        });
        return false;
      }

      const approval = toApprovalRequest(rawRequest, session.role ?? "build");
      this.pendingApprovalsByRequestId.set(approval.requestId, {
        runtimeId: session.runtimeId,
        request: approval,
      });
      const requestIds = this.pendingApprovalIdsBySessionId.get(session.threadId) ?? new Set();
      requestIds.add(approval.requestId);
      this.pendingApprovalIdsBySessionId.set(session.threadId, requestIds);
      this.emitSessionEvent(session.threadId, {
        ...approval,
        type: "approval_required",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    if (requestId === undefined) {
      throw new Error("Codex app-server tool request is missing a numeric id.");
    }

    await this.options.respondServerRequest(
      session.runtimeId,
      requestId,
      {
        contentItems: [
          {
            type: "inputText",
            text: "OpenDucktor workflow tools are provided through the openducktor MCP server, not Codex dynamic tools.",
          },
        ],
        success: false,
      },
      undefined,
    );
    this.emitSessionEvent(session.threadId, {
      type: "session_error",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      message:
        "Rejected Codex dynamic tool request because OpenDucktor workflow tools must use MCP.",
    });
    return false;
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    const session = this.sessions.get(input.externalSessionId);
    const { client } = session
      ? { client: this.clientForRuntime(session.runtimeId) }
      : await this.resolveRuntimeClient(input, "load Codex session diff");
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

  private clientForRuntime(runtimeId: string): CodexAppServerClient {
    const existing = this.clientsByRuntimeId.get(runtimeId);
    if (existing) {
      return existing;
    }

    const client = createCodexAppServerClient(this.options.transportFactory(runtimeId));
    this.clientsByRuntimeId.set(runtimeId, client);
    return client;
  }

  private async resolveRuntimeClient(
    input:
      | ListAgentModelsInput
      | StartAgentSessionInput
      | ResumeAgentSessionInput
      | AttachAgentSessionInput
      | ForkAgentSessionInput
      | ListLiveAgentSessionsInput
      | ListSessionPresenceInput
      | ReadSessionPresenceInput
      | LoadAgentSessionHistoryInput
      | LoadAgentSessionDiffInput,
    action: string,
    options: { requireLive?: boolean } = {},
  ): Promise<{
    runtimeId: string;
    client: CodexAppServerClient;
  }> {
    const resolver = this.options.repoRuntimeResolver;
    if (!resolver) {
      throw new Error(
        `Repo runtime resolver is required to ${action} for repo '${input.repoPath}' and runtime 'codex'.`,
      );
    }

    const runtimeRef = { repoPath: input.repoPath, runtimeKind: "codex" as const };
    const requestedRuntimeId = "runtimeId" in input ? input.runtimeId : undefined;
    const runtime = requestedRuntimeId
      ? await this.requireRuntimeById(runtimeRef, requestedRuntimeId)
      : options.requireLive
        ? await resolver.requireRepoRuntime(runtimeRef)
        : await resolver.ensureRepoRuntime(runtimeRef);

    const { runtimeId } = resolveCodexRuntimeClientInput(
      runtime,
      {
        repoPath: input.repoPath,
        runtimeKind: "codex",
        ...("workingDirectory" in input ? { workingDirectory: input.workingDirectory } : {}),
      },
      action,
    );

    return {
      runtimeId,
      client: this.clientForRuntime(runtimeId),
    };
  }

  private async requireRuntimeById(
    runtimeRef: { repoPath: string; runtimeKind: "codex" },
    runtimeId: string,
  ) {
    const resolver = this.options.repoRuntimeResolver;
    if (resolver.requireRuntimeById) {
      return resolver.requireRuntimeById(runtimeRef, runtimeId);
    }
    const runtime = await resolver.requireRepoRuntime(runtimeRef);
    if (runtime.runtimeId !== runtimeId) {
      throw new Error(
        `No live Codex runtime found for repo '${runtimeRef.repoPath}' with runtime id '${runtimeId}'.`,
      );
    }
    return runtime;
  }
}
