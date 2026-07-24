import {
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
  CODEX_RUNTIME_DESCRIPTOR,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type RuntimeDescriptor,
  slashCommandCatalogSchema,
} from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionHistoryMessage,
  AgentSessionPort,
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
  ListAgentSubagentsInput,
  ListSessionRuntimeSnapshotsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  PolicyBoundSessionRef,
  ReadSessionRuntimeSnapshotInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  agentSessionRefsEqual,
  classifyAgentSessionActivity,
  classifySystemSlashCommandInvocation,
  formatWorkflowAgentSessionTitle,
  requireWorkflowAgentSessionScope,
  withAgentSessionRef,
} from "@openducktor/core";
import { requireCodexPendingRequestKey } from "./codex-app-server-approvals";
import { codexApprovalResponseForRequest } from "./codex-app-server-requests";
import { type ActiveCodexTurn, unsupported } from "./codex-app-server-shared";
import { createCodexAcceptedUserMessage } from "./codex-app-server-streaming";
import type { CodexThreadInventory } from "./codex-app-server-threads";
import { codexTodosFromThreadRead } from "./codex-app-server-transcript";
import { CodexContextUsageLoader } from "./codex-context-usage-loader";
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
  sessionStateFromThreadSnapshot,
  sessionStateFromThreadStart,
} from "./codex-session-lifecycle";
import {
  assertCodexRuntimePolicyBinding,
  codexPolicyLogEntry,
  codexTransportPolicy,
  requireCodexRuntimePolicy,
} from "./codex-session-policy";
import { codexSessionRef } from "./codex-session-ref";
import {
  listCodexSessionRuntimeSnapshots,
  readCodexSessionRuntimeSnapshot,
} from "./codex-session-runtime-snapshot-reader";
import {
  CodexSubagentLinkState,
  type CodexSubagentRoute,
  codexSubagentRouteEventFields,
} from "./codex-subagent-link-state";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";
import {
  type CodexTurnLifecycleContext,
  flushQueuedUserMessagesLater as flushQueuedUserMessagesLaterImpl,
  startCodexTurnForSession,
} from "./codex-turn-lifecycle";
import { assertCodexUserMessagePartsSupported } from "./codex-user-inputs";
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
  CodexLiveApprovalReplyInput,
  CodexLiveQuestionReplyInput,
  CodexLiveSessionLocator,
  CodexServerRequestResponder,
  CodexSessionContextUsage,
  CodexSessionState,
} from "./types";

export { createCodexAppServerClient } from "./app-server-client";

const toLivePendingApproval = (
  request: AgentPendingApprovalRequest,
): AgentSessionLivePendingApprovalRequest => ({
  requestId: request.requestId,
  requestType: request.requestType,
  title: request.title,
  ...(request.summary !== undefined ? { summary: request.summary } : {}),
  ...(request.details !== undefined ? { details: request.details } : {}),
  ...(request.affectedPaths !== undefined ? { affectedPaths: [...request.affectedPaths] } : {}),
  ...(request.command
    ? {
        command: {
          command: request.command.command,
          ...(request.command.workingDirectory !== undefined
            ? { workingDirectory: request.command.workingDirectory }
            : {}),
        },
      }
    : {}),
  ...(request.action
    ? {
        action: {
          name: request.action.name,
          ...(request.action.description !== undefined
            ? { description: request.action.description }
            : {}),
        },
      }
    : {}),
  ...(request.tool
    ? {
        tool: {
          name: request.tool.name,
          ...(request.tool.title !== undefined ? { title: request.tool.title } : {}),
          ...(request.tool.input !== undefined ? { input: request.tool.input } : {}),
        },
      }
    : {}),
  ...(request.mutation !== undefined ? { mutation: request.mutation } : {}),
  ...(request.supportedReplyOutcomes !== undefined
    ? { supportedReplyOutcomes: [...request.supportedReplyOutcomes] }
    : {}),
});

const toLivePendingQuestion = (
  request: AgentPendingQuestionRequest,
): AgentSessionLivePendingQuestionRequest => ({
  requestId: request.requestId,
  questions: request.questions.map((question) => ({
    header: question.header,
    question: question.question,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
    })),
    ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
    ...(question.custom !== undefined ? { custom: question.custom } : {}),
  })),
});

export class CodexAppServerAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly runtimeClients: CodexRuntimeClientResolver;
  private readonly sessionEvents = new CodexSessionEventBus();
  private readonly pendingInput = new CodexPendingInputState();
  private readonly activeTurnsBySessionId = new Map<string, ActiveCodexTurn>();
  private readonly localSessions: CodexLocalSessionState;
  private readonly contextUsageLoader: CodexContextUsageLoader;
  private readonly runtimeEvents: CodexRuntimeSessionEvents;
  private readonly models = new CodexModels();
  private readonly threadInventory = new CodexThreadInventoryReader();
  private readonly subagents = new CodexSubagentLinkState();

  constructor(private readonly options: CodexAppServerAdapterOptions) {
    this.runtimeClients = new CodexRuntimeClientResolver(options);
    const runtimeEventSubscription = options.subscribeEvents
      ? {
          subscribeEvents: options.subscribeEvents,
          onRuntimeEventQueueFailure: options.onRuntimeEventQueueFailure,
        }
      : {};
    this.runtimeEvents = new CodexRuntimeSessionEvents({
      ...runtimeEventSubscription,
      respondServerRequest: options.respondServerRequest,
      ...(options.onLiveSessionMutation
        ? {
            onLiveSessionMutation: async (mutation) =>
              options.onLiveSessionMutation?.({
                ...mutation,
                snapshots: this.listLiveSessionSnapshots(mutation.runtimeId),
              }),
          }
        : {}),
      ...(options.onCatalogInvalidated
        ? { onCatalogInvalidated: options.onCatalogInvalidated }
        : {}),
      sessions: {
        get: (externalSessionId) => this.localSessions.get(externalSessionId),
        values: () => this.localSessions.values(),
      },
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      sessionEvents: this.sessionEvents,
      pendingInput: this.pendingInput,
      subagents: this.subagents,
      updateThreadStatus: (runtimeId, threadId, status) =>
        this.threadInventory.updateThreadStatus(runtimeId, threadId, status),
      flushQueuedUserMessagesLater: (activeTurn) => this.flushQueuedUserMessagesLater(activeTurn),
    });
    this.localSessions = new CodexLocalSessionState({
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      pendingInput: this.pendingInput,
      subagents: this.subagents,
      threadStatusOverrides: {
        clear: (runtimeId, threadId) => this.threadInventory.clearThreadStatus(runtimeId, threadId),
      },
      sessionEvents: {
        clear: (session) => this.sessionEvents.clear(codexSessionRef(session)),
      },
      runtimeEvents: this.runtimeEvents,
    });
    this.contextUsageLoader = new CodexContextUsageLoader({
      runtimeClients: this.runtimeClients,
      runtimeEvents: this.runtimeEvents,
      localSessions: this.localSessions,
      subagents: this.subagents,
      prepareRuntime: (runtimeId) => this.prepareRuntime(runtimeId),
      clearThreadInventory: (runtimeId) => this.clearThreadInventory(runtimeId),
    });
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return CODEX_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async prepareRuntime(runtimeId: string): Promise<void> {
    if (!this.options.subscribeEvents) {
      throw new Error(
        `Cannot prepare Codex runtime '${runtimeId}' because live event subscription is unavailable.`,
      );
    }
    this.requireServerRequestResponder(runtimeId);
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
  }

  releaseRuntime(runtimeId: string): void {
    this.contextUsageLoader.cancelRuntime(runtimeId);
    const failures: Array<{ label: string; cause: unknown }> = [];
    const cleanup = (label: string, operation: () => void): void => {
      try {
        operation();
      } catch (cause) {
        failures.push({ label, cause });
      }
    };

    cleanup("sessions", () => this.localSessions.releaseRuntime(runtimeId));
    cleanup("pending input", () => this.pendingInput.clearRuntime(runtimeId));
    cleanup("subagents", () => this.subagents.clearRuntime(runtimeId));
    cleanup("runtime events", () => this.runtimeEvents.clearRuntime(runtimeId));
    cleanup("thread inventory", () => this.clearThreadInventory(runtimeId));

    if (failures.length > 0) {
      const details = failures
        .map(({ label, cause }) => `${label}: ${cause instanceof Error ? cause.message : cause}`)
        .join("\n");
      throw new AggregateError(
        failures.map(({ cause }) => cause),
        `Failed to release Codex runtime '${runtimeId}':\n${details}`,
      );
    }
  }

  private requireServerRequestResponder(runtimeId: string): CodexServerRequestResponder {
    const respondServerRequest = this.options.respondServerRequest;
    if (!respondServerRequest) {
      throw new Error(
        `Cannot handle Codex live input for runtime '${runtimeId}' because server-request replies are unavailable.`,
      );
    }
    return respondServerRequest;
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "list available models");
    return toCatalog(await this.models.list(client, runtimeId));
  }

  private clearThreadInventory(runtimeId: string): void {
    this.threadInventory.clearInventory(runtimeId);
  }

  private recordInventorySubagentRoutes(
    inventory: CodexThreadInventory,
    runtimeId: string,
    workingDirectory: string,
  ): void {
    for (const thread of inventory.threadsById.values()) {
      if (thread.cwd !== workingDirectory) {
        continue;
      }
      this.subagents.recordThread(thread, runtimeId);
    }
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "start Codex session");
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "start session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const transportModel = toTransportModelSelection(model);
    const policy = requireCodexRuntimePolicy(input.runtimePolicy, "start Codex session");

    this.options.logSessionPolicy?.(
      codexPolicyLogEntry({
        operation: "thread/start",
        policy,
        runtimeId,
        workingDirectory: input.workingDirectory,
      }),
    );
    const response = await client.threadStart({
      ...codexTransportPolicy(policy),
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: transportModel.model,
      effort: transportModel.effort,
    });
    this.clearThreadInventory(runtimeId);
    const scope = requireWorkflowAgentSessionScope(input.sessionScope, "start Codex session");
    const title = formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
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
    assertCodexRuntimePolicyBinding(input, "resume Codex session");
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "resume session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const policy = requireCodexRuntimePolicy(input.runtimePolicy, "resume Codex session");

    this.options.logSessionPolicy?.(
      codexPolicyLogEntry({
        operation: "thread/resume",
        policy,
        runtimeId,
        threadId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      }),
    );
    const response = await client.threadResume({
      ...codexTransportPolicy(policy),
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
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
    assertCodexRuntimePolicyBinding(input, "fork Codex session");
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "fork session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const policy = requireCodexRuntimePolicy(input.runtimePolicy, "fork Codex session");

    this.options.logSessionPolicy?.(
      codexPolicyLogEntry({
        operation: "thread/fork",
        policy,
        runtimeId,
        threadId: input.parentExternalSessionId,
        workingDirectory: input.workingDirectory,
      }),
    );
    const response = await client.threadFork({
      ...codexTransportPolicy(policy),
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    });
    this.clearThreadInventory(runtimeId);
    const scope = requireWorkflowAgentSessionScope(input.sessionScope, "fork Codex session");
    const title = formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
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
    assertCodexRuntimePolicyBinding(input, "send Codex user message");
    const systemInvocation = classifySystemSlashCommandInvocation(input.parts);
    if (systemInvocation.kind === "not_system") {
      assertCodexUserMessagePartsSupported(input.parts);
    }
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    const registeredSessionRef = codexSessionRef(session);
    if (!agentSessionRefsEqual(registeredSessionRef, input)) {
      throw new Error(
        `Cannot send Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
      );
    }
    applyRuntimeContextToSession(session, input);
    const acceptedUserMessage = createCodexAcceptedUserMessage({
      session,
      parts: input.parts,
      model: input.model ?? session.model ?? undefined,
    });
    if (systemInvocation.kind === "manual_session_compaction") {
      await this.runtimeEvents.ensureRuntimeEventSubscription(session.runtimeId);
      const client = this.runtimeClients.clientForRuntime(session.runtimeId);
      try {
        await client.threadCompactStart({ threadId: session.threadId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Codex failed to compact thread '${session.threadId}': ${message}`);
      }
      return acceptedUserMessage;
    }
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
    return slashCommandCatalogSchema.parse({
      commands: [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
    });
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

  async listAvailableSubagents(_: ListAgentSubagentsInput) {
    return unsupported("listAvailableSubagents");
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
    assertCodexRuntimePolicyBinding(input, "load Codex session history");
    const session = this.localSessions.get(input.externalSessionId);
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
    });
  }

  async loadSessionContextUsage(
    input: PolicyBoundSessionRef,
  ): Promise<CodexSessionContextUsage | null> {
    assertCodexRuntimePolicyBinding(input, "load Codex session context usage");
    return this.contextUsageLoader.loadSession(input);
  }

  async loadLiveSessionContextUsage(
    input: CodexLiveSessionLocator,
  ): Promise<CodexSessionContextUsage | null> {
    return this.contextUsageLoader.loadLive(input);
  }

  listLiveSessionSnapshots(runtimeId: string): AgentSessionLiveSnapshot[] {
    const sessions = [...this.localSessions.values()].filter(
      (session) => session.runtimeId === runtimeId,
    );
    const localSessionIds = new Set(sessions.map((session) => session.threadId));
    const snapshots = sessions.map((session) => this.toLiveSessionSnapshot(session));
    const visited = new Set(localSessionIds);
    const appendRoutedDescendants = (
      retainedAncestor: CodexSessionState,
      parentExternalSessionId: string,
    ): void => {
      for (const route of this.subagents.routesForParent(parentExternalSessionId, runtimeId)) {
        if (visited.has(route.childExternalSessionId)) {
          continue;
        }
        visited.add(route.childExternalSessionId);
        snapshots.push(this.toRoutedChildLiveSessionSnapshot(retainedAncestor, route));
        appendRoutedDescendants(retainedAncestor, route.childExternalSessionId);
      }
    };
    for (const session of sessions) {
      appendRoutedDescendants(session, session.threadId);
    }
    return snapshots;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    assertCodexRuntimePolicyBinding(input, "load Codex session todos");
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
      codexTransportPolicy(
        requireCodexRuntimePolicy(input.runtimePolicy, "load Codex session todos"),
      ),
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

  async updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void> {
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

  private async ensureSessionState(input: PolicyBoundSessionRef): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "ensure Codex session state");
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "ensure session state");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? (input.model ?? undefined) : undefined;
    if (model) {
      await this.models.validate(client, runtimeId, model);
    }

    const policy = requireCodexRuntimePolicy(input.runtimePolicy, "ensure Codex session state");
    const response = await client.threadResume({
      ...codexTransportPolicy(policy),
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      ...("systemPrompt" in input && input.systemPrompt
        ? { developerInstructions: input.systemPrompt }
        : {}),
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

  async releaseSession(input: SessionRef): Promise<void> {
    const session = this.localSessions.get(input.externalSessionId);
    if (session) {
      const sessionRef = codexSessionRef(session);
      if (!agentSessionRefsEqual(sessionRef, input)) {
        throw new Error(
          `Cannot release Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
        );
      }
    }
    this.contextUsageLoader.cancelSession(input);
    if (session) {
      this.localSessions.release(input.externalSessionId);
    }
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
    assertCodexRuntimePolicyBinding(input, "reply to Codex approval");
    requireCodexPendingRequestKey(input.requestId, "approval");
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    applyRuntimeContextToSession(session, input);
    await this.replyLiveApproval({
      runtimeId: session.runtimeId,
      externalSessionId: input.externalSessionId,
      requestId: input.requestId,
      outcome: input.outcome,
      ...(input.message !== undefined ? { message: input.message } : {}),
    });
  }

  async replyLiveApproval(input: CodexLiveApprovalReplyInput): Promise<void> {
    requireCodexPendingRequestKey(input.requestId, "approval");
    const pending = this.pendingInput.claimApprovalForSession(
      input.requestId,
      input.externalSessionId,
      input.runtimeId,
    );
    const nativeRequest = pending.nativeRequest;
    try {
      const supportedOutcomes = pending.request.supportedReplyOutcomes ?? [
        "approve_once",
        "reject",
      ];
      if (!supportedOutcomes.includes(input.outcome)) {
        throw new Error(
          `Codex approval request '${input.requestId}' does not support outcome '${input.outcome}'.`,
        );
      }
      await this.requireServerRequestResponder(pending.runtimeId)(
        pending.runtimeId,
        nativeRequest.id,
        codexApprovalResponseForRequest({
          outcome: input.outcome,
          request: nativeRequest,
          message: input.message,
        }),
        undefined,
      );
    } catch (error) {
      this.pendingInput.releaseApprovalReplyClaim(input.requestId, pending.runtimeId);
      throw error;
    }
    const activeTurn = this.pendingInput.resolveApproval(input.requestId, pending.runtimeId);
    this.runtimeEvents.forgetHandledServerRequest(
      pending.runtimeId,
      pending.threadId,
      nativeRequest.id,
    );
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.runtimeEvents.continueTurnAfterPendingInput(activeTurn);
    }
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    assertCodexRuntimePolicyBinding(input, "reply to Codex question");
    requireCodexPendingRequestKey(input.requestId, "question");
    if (!this.localSessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    }
    applyRuntimeContextToSession(session, input);
    await this.replyLiveQuestion({
      runtimeId: session.runtimeId,
      externalSessionId: input.externalSessionId,
      requestId: input.requestId,
      answers: input.answers,
    });
  }

  async replyLiveQuestion(input: CodexLiveQuestionReplyInput): Promise<AgentEvent> {
    requireCodexPendingRequestKey(input.requestId, "question");
    const pending = this.pendingInput.claimQuestionForSession(
      input.requestId,
      input.externalSessionId,
      input.runtimeId,
    );
    const questionToolCallId = pending.request.requestInstanceId ?? pending.request.requestId;
    let completedQuestionEvent: AgentEvent;
    try {
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
      completedQuestionEvent = {
        type: "assistant_part",
        externalSessionId: input.externalSessionId,
        timestamp: new Date().toISOString(),
        part: requireNormalizedCodexToolInvocation({
          messageId: `codex-question-${questionToolCallId}`,
          partId: `codex-question-${questionToolCallId}`,
          callId: questionToolCallId,
          rawToolName: "request_user_input",
          status: "completed",
          input: pending.input,
          output,
          metadata: {
            codexServerRequest: true,
            requestId: input.requestId,
            questions: pending.request.questions,
            answers,
          },
        }),
      };
      await this.requireServerRequestResponder(pending.runtimeId)(
        pending.runtimeId,
        pending.nativeRequest.id,
        { answers },
        undefined,
      );
    } catch (error) {
      this.pendingInput.releaseQuestionReplyClaim(input.requestId, pending.runtimeId);
      throw error;
    }
    const activeTurn = this.pendingInput.resolveQuestion(input.requestId, pending.runtimeId);
    this.runtimeEvents.forgetHandledServerRequest(
      pending.runtimeId,
      pending.threadId,
      pending.nativeRequest.id,
    );
    this.emitSessionEvent(input.externalSessionId, completedQuestionEvent);
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.runtimeEvents.continueTurnAfterPendingInput(activeTurn);
    }
    return completedQuestionEvent;
  }

  private toLiveSessionSnapshot(session: CodexSessionState): AgentSessionLiveSnapshot {
    const pendingApprovals = this.pendingInput
      .pendingApprovalsForSession(session.threadId, session.runtimeId)
      .map(toLivePendingApproval);
    const pendingQuestions = this.pendingInput
      .pendingQuestionsForSession(session.threadId, session.runtimeId)
      .map(toLivePendingQuestion);
    const runtimeActivity =
      session.liveStatus?.classification ??
      (session.summary.status === "running" || session.summary.status === "starting"
        ? "running"
        : "idle");
    const route = this.subagents.routeForChild(session.threadId, session.runtimeId);
    return agentSessionLiveSnapshotSchema.parse({
      ref: codexSessionRef(session),
      activity: classifyAgentSessionActivity({
        runtimeActivity,
        pendingApprovals,
        pendingQuestions,
      }),
      title: session.summary.title ?? session.threadId,
      startedAt: session.summary.startedAt,
      ...(route ? { parentExternalSessionId: route.parentExternalSessionId } : {}),
      pendingApprovals,
      pendingQuestions,
      contextUsage: this.runtimeEvents.latestContextUsage(session.runtimeId, session.threadId),
    });
  }

  private toRoutedChildLiveSessionSnapshot(
    parentSession: CodexSessionState,
    route: CodexSubagentRoute,
  ): AgentSessionLiveSnapshot {
    const pendingApprovals = this.pendingInput
      .pendingApprovalsForSession(route.childExternalSessionId, parentSession.runtimeId)
      .map(toLivePendingApproval);
    const pendingQuestions = this.pendingInput
      .pendingQuestionsForSession(route.childExternalSessionId, parentSession.runtimeId)
      .map(toLivePendingQuestion);
    const contextUsage = this.runtimeEvents.latestContextUsage(
      parentSession.runtimeId,
      route.childExternalSessionId,
    );
    const childStatus = this.subagents.statusForChild(
      route.childExternalSessionId,
      parentSession.runtimeId,
    );
    const isRunning = childStatus === "pending" || childStatus === "running";
    return agentSessionLiveSnapshotSchema.parse({
      ref: {
        ...codexSessionRef(parentSession),
        externalSessionId: route.childExternalSessionId,
      },
      activity: classifyAgentSessionActivity({
        runtimeActivity: isRunning ? "running" : "idle",
        pendingApprovals,
        pendingQuestions,
      }),
      title: route.childExternalSessionId,
      startedAt: parentSession.summary.startedAt,
      parentExternalSessionId: route.parentExternalSessionId,
      pendingApprovals,
      pendingQuestions,
      contextUsage,
    });
  }

  async subscribeEvents(
    input: PolicyBoundSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe> {
    assertCodexRuntimePolicyBinding(input, "subscribe Codex session events");
    const externalSessionId = input.externalSessionId;
    const preparedRuntimeId = !this.localSessions.has(externalSessionId)
      ? await this.prepareLiveSessionSubscription(input)
      : undefined;

    const session = this.localSessions.get(externalSessionId);
    const registeredSessionRef = session ? codexSessionRef(session) : input;
    if (session && !agentSessionRefsEqual(registeredSessionRef, input)) {
      throw new Error(
        `Cannot subscribe Codex session events for '${externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
      );
    }

    const unsubscribe = this.sessionEvents.subscribe(registeredSessionRef, listener);
    for (const { request: approval, route } of this.pendingInput.pendingApprovalEventsForSession(
      externalSessionId,
      session?.runtimeId ?? preparedRuntimeId,
    )) {
      listener(
        withAgentSessionRef(registeredSessionRef, {
          ...approval,
          type: "approval_required",
          externalSessionId,
          timestamp: new Date().toISOString(),
          ...codexSubagentRouteEventFields(route),
        }),
      );
    }
    for (const { request: question, route } of this.pendingInput.pendingQuestionEventsForSession(
      externalSessionId,
      session?.runtimeId ?? preparedRuntimeId,
    )) {
      listener(
        withAgentSessionRef(registeredSessionRef, {
          ...question,
          type: "question_required",
          externalSessionId,
          timestamp: new Date().toISOString(),
          ...codexSubagentRouteEventFields(route),
        }),
      );
    }
    return unsubscribe;
  }

  private async prepareLiveSessionSubscription(input: PolicyBoundSessionRef): Promise<string> {
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "subscribe session events",
    );
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const inventory = await this.threadInventory.refresh(client, runtimeId);
    this.recordInventorySubagentRoutes(inventory, runtimeId, input.workingDirectory);
    const thread = inventory.threadsById.get(input.externalSessionId);
    if (!thread) {
      if (this.subagents.routeForChild(input.externalSessionId, runtimeId)) {
        await this.ensureSessionState(input);
        this.clearThreadInventory(runtimeId);
      }
      return runtimeId;
    }
    if (thread.cwd !== input.workingDirectory) {
      return runtimeId;
    }
    this.subagents.recordThread(thread, runtimeId);
    if (thread.status.classification === "idle") {
      const isRoutedChild = Boolean(
        this.subagents.routeForChild(input.externalSessionId, runtimeId),
      );
      const hasActiveRoutedChild = this.subagents
        .routesForParent(input.externalSessionId, runtimeId)
        .some((route) => {
          const childThread = inventory.threadsById.get(route.childExternalSessionId);
          return childThread !== undefined && childThread.status.classification !== "idle";
        });
      if (!isRoutedChild && !hasActiveRoutedChild) {
        return runtimeId;
      }
      const session = sessionStateFromThreadSnapshot(input, runtimeId, thread);
      this.localSessions.remember(
        preserveRuntimeContextForExistingThread(
          session,
          this.localSessions.get(session.summary.externalSessionId),
        ),
      );
      return runtimeId;
    }

    await this.ensureSessionState(input);
    this.clearThreadInventory(runtimeId);
    return runtimeId;
  }

  async stopSession(input: SessionRef): Promise<void> {
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

    this.contextUsageLoader.cancelSession(input);
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
      sessions: this.localSessions,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      clientForRuntime: (runtimeId) => this.runtimeClients.clientForRuntime(runtimeId),
      validateModel: (client, runtimeId, model) => this.models.validate(client, runtimeId, model),
      ensureRuntimeEventSubscription: (runtimeId) =>
        this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId),
      bindActiveTurnId: (activeTurn, turnId, startedAtMs) =>
        this.runtimeEvents.bindActiveTurnId(activeTurn, turnId, startedAtMs),
      bindPendingInputToActiveTurn: (externalSessionId, activeTurn) =>
        this.runtimeEvents.bindPendingInputToActiveTurn(externalSessionId, activeTurn),
      setSessionLiveStatus: (session, liveStatus) =>
        this.runtimeEvents.setSessionLiveStatus(session, liveStatus),
      emitUserMessage: (event, sourceParts) =>
        this.runtimeEvents.emitUserMessage(event, sourceParts),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
      codexPolicyForSession: (session) =>
        requireCodexRuntimePolicy(session.runtimePolicy, "start Codex turn"),
      ...(this.options.logSessionPolicy ? { logSessionPolicy: this.options.logSessionPolicy } : {}),
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
