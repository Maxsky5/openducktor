import { CODEX_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListSessionRuntimeSnapshotsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReadSessionRuntimeSnapshotInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  agentSessionRefsEqual,
  formatWorkflowAgentSessionTitle,
  withAgentSessionRef,
} from "@openducktor/core";
import { requireCodexServerRequestId } from "./codex-app-server-approvals";
import { codexApprovalResponseForRequest } from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  CODEX_USER_INPUT_REQUEST_METHOD,
  isPlainObject,
  unsupported,
} from "./codex-app-server-shared";
import { createCodexAcceptedUserMessage } from "./codex-app-server-streaming";
import { codexTodosFromThreadRead } from "./codex-app-server-transcript";
import { toFileDiffs } from "./codex-file-diffs";
import { CodexLocalSessionState } from "./codex-local-session-state";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { loadCodexSessionHistory } from "./codex-session-history";
import {
  applyRuntimeContextToSession,
  preserveRuntimeContextForExistingThread,
  sessionStateFromExistingThread,
  sessionStateFromThreadFork,
  sessionStateFromThreadResume,
  sessionStateFromThreadStart,
} from "./codex-session-lifecycle";
import {
  OPENDUCKTOR_CODEX_APPROVAL_POLICY,
  OPENDUCKTOR_CODEX_SANDBOX_MODE,
} from "./codex-session-policy";
import { codexSessionRef } from "./codex-session-ref";
import {
  listCodexSessionRuntimeSnapshots,
  readCodexSessionRuntimeSnapshot,
} from "./codex-session-runtime-snapshot-reader";
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
import type { CodexAppServerAdapterOptions, CodexAppServerClient } from "./types";

export { createCodexAppServerClient } from "./app-server-client";

export class CodexAppServerAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly runtimeClients: CodexRuntimeClientResolver;
  private readonly sessionEvents = new CodexSessionEventBus();
  private readonly pendingInput = new CodexPendingInputState();
  private readonly activeTurnsBySessionId = new Map<string, ActiveCodexTurn>();
  private readonly localSessions: CodexLocalSessionState;
  private readonly runtimeEvents: CodexRuntimeSessionEvents;
  private readonly models = new CodexModels();
  private readonly threadInventory = new CodexThreadInventoryReader();

  constructor(private readonly options: CodexAppServerAdapterOptions) {
    this.runtimeClients = new CodexRuntimeClientResolver(options);
    this.runtimeEvents = new CodexRuntimeSessionEvents({
      subscribeEvents: options.subscribeEvents,
      drainServerRequests: options.drainServerRequests,
      drainNotifications: options.drainNotifications,
      respondServerRequest: options.respondServerRequest,
      sessions: {
        get: (externalSessionId) => this.localSessions.get(externalSessionId),
        values: () => this.localSessions.values(),
      },
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      sessionEvents: this.sessionEvents,
      pendingInput: this.pendingInput,
      updateThreadStatus: (runtimeId, threadId, status) =>
        this.threadInventory.updateThreadStatus(runtimeId, threadId, status),
      flushQueuedUserMessagesLater: (activeTurn) => this.flushQueuedUserMessagesLater(activeTurn),
    });
    this.localSessions = new CodexLocalSessionState({
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      pendingInput: this.pendingInput,
      threadStatusOverrides: {
        clear: (runtimeId, threadId) => this.threadInventory.clearThreadStatus(runtimeId, threadId),
      },
      sessionEvents: {
        clear: (session) => this.sessionEvents.clear(codexSessionRef(session)),
      },
      runtimeEvents: this.runtimeEvents,
    });
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return CODEX_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "list available models");
    return toCatalog(await this.models.list(client, runtimeId));
  }

  private clearThreadInventory(runtimeId: string): void {
    this.threadInventory.clearInventory(runtimeId);
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "start session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const transportModel = toTransportModelSelection(model);

    const response = await client.threadStart({
      approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      sandbox: OPENDUCKTOR_CODEX_SANDBOX_MODE,
      model: transportModel.model,
      effort: transportModel.effort,
    });
    this.clearThreadInventory(runtimeId);
    const title = formatWorkflowAgentSessionTitle(input.role, input.taskId);
    const session = sessionStateFromThreadStart(input, runtimeId, model, response, title);
    const { summary } = session;
    this.localSessions.remember(session);
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });

    return summary;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "resume session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);

    const response = await client.threadResume({
      approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
      sandbox: OPENDUCKTOR_CODEX_SANDBOX_MODE,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    const { summary } = session;
    this.localSessions.remember(session);

    return summary;
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "fork session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);

    const response = await client.threadFork({
      approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      sandbox: OPENDUCKTOR_CODEX_SANDBOX_MODE,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const title = formatWorkflowAgentSessionTitle(input.role, input.taskId);
    const session = sessionStateFromThreadFork(input, runtimeId, model, response, title);
    const { summary } = session;
    this.localSessions.remember(session);
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });

    return summary;
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage> {
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    applyRuntimeContextToSession(session, input);
    const acceptedUserMessage = createCodexAcceptedUserMessage({
      session,
      parts: input.parts,
      model: input.model ?? session.model ?? undefined,
    });
    return startCodexTurnForSession(
      this.turnLifecycleContext(),
      input.externalSessionId,
      input.parts,
      acceptedUserMessage,
      input.model,
    );
  }

  private flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void {
    flushQueuedUserMessagesLaterImpl(this.turnLifecycleContext(), activeTurn);
  }

  async listAvailableSlashCommands(_: ListAgentSlashCommandsInput) {
    return unsupported("listAvailableSlashCommands");
  }

  async listAvailableSkills(input: ListAgentSkillsInput): Promise<AgentSkillCatalog> {
    const { client } = await this.runtimeClients.resolve(input, "list available skills");
    return toCodexSkillCatalog(
      await client.skillsList({
        cwd: input.workingDirectory,
        forceReload: false,
      }),
    );
  }

  async searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]> {
    const { client } = await this.runtimeClients.resolve(input, "search files");
    return searchCodexFiles(client, {
      query: input.query,
      workingDirectory: input.workingDirectory,
    });
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const session = this.localSessions.get(input.externalSessionId);
    const runtime = session
      ? {
          client: this.runtimeClients.clientForRuntime(session.runtimeId),
          runtimeId: session.runtimeId,
        }
      : await this.runtimeClients.resolve(input, "load Codex session history");
    const history = await loadCodexSessionHistory({
      input,
      session,
      runtime,
      threadInventory: this.threadInventory,
      rememberTodos: (externalSessionId, todos) =>
        this.runtimeEvents.rememberTodos(externalSessionId, todos),
      ...this.runtimeEvents.historyLoadContext(),
    });
    this.restoreIdleContextUsageInBackground(input, runtime, history);
    return history;
  }

  private restoreIdleContextUsageInBackground(
    input: LoadAgentSessionHistoryInput,
    runtime: { client: CodexAppServerClient; runtimeId: string },
    history: AgentSessionHistoryMessage[],
  ): void {
    if (history.length === 0) {
      return;
    }

    const hasContextUsage = history.some(
      (message) =>
        "totalTokens" in message &&
        typeof message.totalTokens === "number" &&
        message.totalTokens > 0,
    );
    if (hasContextUsage) {
      return;
    }

    void this.restoreIdleContextUsage(input, runtime).catch((error) => {
      this.emitSessionEvent(input.externalSessionId, {
        sessionRef: input,
        type: "session_error",
        externalSessionId: input.externalSessionId,
        timestamp: new Date().toISOString(),
        message: `Failed to restore Codex context usage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    });
  }

  private async restoreIdleContextUsage(
    input: LoadAgentSessionHistoryInput,
    runtime: { client: CodexAppServerClient; runtimeId: string },
  ): Promise<void> {
    const inventory = await this.threadInventory.read(runtime.client, runtime.runtimeId);
    const thread = inventory.threadsById.get(input.externalSessionId);
    if (
      !thread ||
      thread.cwd !== input.workingDirectory ||
      thread.status.classification !== "idle"
    ) {
      return;
    }

    await this.runtimeEvents.ensureRuntimeEventSubscription(runtime.runtimeId);
    await this.runtimeEvents.captureRestoredContextUsage(input, runtime.runtimeId, async () => {
      await runtime.client.threadResume({
        approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
        threadId: input.externalSessionId,
        cwd: input.workingDirectory,
        sandbox: OPENDUCKTOR_CODEX_SANDBOX_MODE,
        excludeTurns: false,
      });
    });
    this.clearThreadInventory(runtime.runtimeId);
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    const liveTodos = this.runtimeEvents.latestTodos(input.externalSessionId);
    if (liveTodos) {
      return liveTodos;
    }
    const session = this.localSessions.get(input.externalSessionId);
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
    this.runtimeEvents.rememberTodos(input.externalSessionId, todos);
    return todos;
  }

  updateSessionModel(input: UpdateAgentSessionModelInput): void {
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    if (input.model) {
      session.model = input.model;
      return;
    }
    delete session.model;
  }

  private async ensureSessionState(
    input: AgentSessionRef | AgentSessionRuntimeRef,
  ): Promise<AgentSessionSummary> {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "ensure session state");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? (input.model ?? undefined) : undefined;
    if (model) {
      await this.models.validate(client, runtimeId, model);
    }

    const response = await client.threadResume({
      approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...("systemPrompt" in input && input.systemPrompt
        ? { developerInstructions: input.systemPrompt }
        : {}),
      sandbox: OPENDUCKTOR_CODEX_SANDBOX_MODE,
      ...(model ? { model: toTransportModelSelection(model).model } : {}),
      ...(model ? { effort: toTransportModelSelection(model).effort } : {}),
    });
    const session = sessionStateFromExistingThread(input, runtimeId, model, response);
    const { summary } = session;
    const existingThreadSession = preserveRuntimeContextForExistingThread(
      session,
      this.localSessions.get(summary.externalSessionId),
    );
    this.localSessions.remember(existingThreadSession);
    return summary;
  }

  async releaseSession(input: AgentSessionRef): Promise<void> {
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      return;
    }
    const sessionRef = codexSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot release Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    this.localSessions.release(input.externalSessionId);
  }

  async listSessionRuntimeSnapshots(
    input: ListSessionRuntimeSnapshotsInput,
  ): Promise<AgentSessionRuntimeSnapshot[]> {
    return listCodexSessionRuntimeSnapshots(this.runtimeSnapshotReaderDeps(), input);
  }

  async readSessionRuntimeSnapshot(
    input: ReadSessionRuntimeSnapshotInput,
  ): Promise<AgentSessionRuntimeSnapshot> {
    return readCodexSessionRuntimeSnapshot(this.runtimeSnapshotReaderDeps(), input);
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    const requestId = requireCodexServerRequestId(input.requestId, "approval");
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (session) {
      applyRuntimeContextToSession(session, input);
    }
    const pending = this.pendingInput.requireApprovalForSession(
      input.requestId,
      input.externalSessionId,
    );
    const supportedOutcomes = pending.request.supportedReplyOutcomes ?? ["approve_once", "reject"];
    if (!supportedOutcomes.includes(input.outcome)) {
      throw new Error(
        `Codex approval request '${input.requestId}' does not support outcome '${input.outcome}'.`,
      );
    }
    const metadata = isPlainObject(pending.request.metadata) ? pending.request.metadata : {};
    const requestMethod =
      typeof metadata.codexMethod === "string" ? metadata.codexMethod : "approval/request";
    const requestParams = metadata.params;
    await this.options.respondServerRequest(
      pending.runtimeId,
      requestId,
      codexApprovalResponseForRequest({
        outcome: input.outcome,
        request: {
          id: requestId,
          method: requestMethod,
          ...(requestParams !== undefined ? { params: requestParams } : {}),
        },
        message: input.message,
      }),
      undefined,
    );
    const activeTurn = this.pendingInput.resolveApproval(input.requestId);
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.runtimeEvents.continueTurnAfterPendingInput(activeTurn);
    }
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const requestId = requireCodexServerRequestId(input.requestId, "question");
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (session) {
      applyRuntimeContextToSession(session, input);
    }
    const pending = this.pendingInput.requireQuestionForSession(
      input.requestId,
      input.externalSessionId,
    );
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
    const activeTurn = this.pendingInput.resolveQuestion(input.requestId);
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.runtimeEvents.continueTurnAfterPendingInput(activeTurn);
    }
  }

  async subscribeEvents(
    input: AgentSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe> {
    const externalSessionId = input.externalSessionId;
    if (!this.localSessions.has(externalSessionId)) {
      await this.prepareLiveSessionSubscription(input);
    }

    const session = this.localSessions.get(externalSessionId);
    if (!session) {
      return this.sessionEvents.subscribe(input, listener);
    }
    const registeredSessionRef = codexSessionRef(session);
    if (!agentSessionRefsEqual(registeredSessionRef, input)) {
      throw new Error(
        `Cannot subscribe Codex session events for '${externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
      );
    }

    const unsubscribe = this.sessionEvents.subscribe(registeredSessionRef, listener);
    for (const approval of this.pendingInput.pendingApprovalsForSession(externalSessionId)) {
      listener(
        withAgentSessionRef(registeredSessionRef, {
          ...approval,
          type: "approval_required",
          externalSessionId,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    for (const question of this.pendingInput.pendingQuestionsForSession(externalSessionId)) {
      listener(
        withAgentSessionRef(registeredSessionRef, {
          ...question,
          type: "question_required",
          externalSessionId,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    void this.runtimeEvents.drainBufferedStreamEvents(externalSessionId);
    return unsubscribe;
  }

  private async prepareLiveSessionSubscription(input: AgentSessionRef): Promise<void> {
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "subscribe session events",
    );
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const inventory = await this.threadInventory.refresh(client, runtimeId);
    const thread = inventory.threadsById.get(input.externalSessionId);
    if (!thread) {
      return;
    }
    if (thread.cwd !== input.workingDirectory || thread.status.classification === "idle") {
      return;
    }

    await this.ensureSessionState(input);
    this.clearThreadInventory(runtimeId);
  }

  async stopSession(input: AgentSessionRef): Promise<void> {
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    const sessionRef = codexSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot stop Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    this.localSessions.release(input.externalSessionId);
  }

  private runtimeSnapshotReaderDeps() {
    return {
      runtimeClients: this.runtimeClients,
      threadInventory: this.threadInventory,
      sessions: this.localSessions,
      pendingInput: this.pendingInput,
      hasActiveTurn: (externalSessionId: string) => {
        const activeTurn = this.activeTurnsBySessionId.get(externalSessionId);
        return Boolean(activeTurn && !activeTurn.isTurnSettled());
      },
    };
  }

  private emitSessionEvent(externalSessionId: string, event: AgentEvent): void {
    const session = this.localSessions.get(externalSessionId);
    if (!session) {
      if (event.sessionRef) {
        this.sessionEvents.emit(event.sessionRef, event);
      }
      return;
    }
    const sessionRef = codexSessionRef(session);
    this.sessionEvents.emit(sessionRef, withAgentSessionRef(sessionRef, event));
  }

  private turnLifecycleContext(): CodexTurnLifecycleContext {
    return {
      subscribeEvents: Boolean(this.options.subscribeEvents),
      shouldDrainNotifications: Boolean(this.options.drainNotifications),
      sessions: this.localSessions,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      clientForRuntime: (runtimeId) => this.runtimeClients.clientForRuntime(runtimeId),
      validateModel: (client, runtimeId, model) => this.models.validate(client, runtimeId, model),
      ensureRuntimeEventSubscription: (runtimeId) =>
        this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId),
      bindActiveTurnId: (activeTurn, turnId) =>
        this.runtimeEvents.bindActiveTurnId(activeTurn, turnId),
      bindPendingInputToActiveTurn: (externalSessionId, activeTurn) =>
        this.runtimeEvents.bindPendingInputToActiveTurn(externalSessionId, activeTurn),
      setSessionLiveStatus: (session, liveStatus) =>
        this.runtimeEvents.setSessionLiveStatus(session, liveStatus),
      handlePendingServerRequests: (session, handledRequestKeys) =>
        this.runtimeEvents.handlePendingServerRequests(session, handledRequestKeys),
      emitUserMessage: (event, sourceParts) =>
        this.runtimeEvents.emitUserMessage(event, sourceParts),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    };
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    const session = this.localSessions.get(input.externalSessionId);
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
