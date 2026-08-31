import {
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveSnapshot,
  type CodexAppServerThreadResumeParams,
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
  withAgentSessionRef,
} from "@openducktor/core";
import { requireCodexPendingRequestKey } from "./codex-app-server-approvals";
import { codexApprovalResponseForRequest } from "./codex-app-server-requests";
import { type ActiveCodexTurn, unsupported } from "./codex-app-server-shared";
import { createCodexAcceptedUserMessage } from "./codex-app-server-streaming";
import type { CodexThreadInventory, CodexThreadStatusSnapshot } from "./codex-app-server-threads";
import { codexTodosFromThreadRead } from "./codex-app-server-transcript";
import { CodexContextUsageLoader } from "./codex-context-usage-loader";
import { fileDiffsFromUnifiedDiff } from "./codex-file-diffs";
import { CodexLocalSessionState } from "./codex-local-session-state";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { releaseCodexRuntimeState } from "./codex-runtime-cleanup";
import { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { loadCodexSessionHistory } from "./codex-session-history";
import {
  assertRuntimeContextCompatibleWithSession,
  preserveRuntimeContextForExistingThread,
  resolveCodexPolicyBoundSession,
  sessionStateFromExistingThread,
  sessionStateFromThreadFork,
  sessionStateFromThreadResume,
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
import { resolveCodexSessionScopePolicy } from "./codex-session-scope-policy";
import {
  CodexSubagentLinkState,
  type CodexSubagentRoute,
  codexSubagentRouteEventFields,
} from "./codex-subagent-link-state";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import {
  requireNormalizedCodexToolInvocation,
  toCodexToolQuestions,
} from "./codex-tool-normalizer";
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
): AgentSessionLivePendingApprovalRequest => {
  const liveRequest: AgentSessionLivePendingApprovalRequest = {
    requestId: request.requestId,
    requestType: request.requestType,
    title: request.title,
  };
  if (request.summary !== undefined) {
    liveRequest.summary = request.summary;
  }
  if (request.details !== undefined) {
    liveRequest.details = request.details;
  }
  if (request.affectedPaths !== undefined) {
    liveRequest.affectedPaths = [...request.affectedPaths];
  }
  if (request.command) {
    liveRequest.command = { command: request.command.command };
    if (request.command.workingDirectory !== undefined) {
      liveRequest.command.workingDirectory = request.command.workingDirectory;
    }
  }
  if (request.action) {
    liveRequest.action = { name: request.action.name };
    if (request.action.description !== undefined) {
      liveRequest.action.description = request.action.description;
    }
  }
  if (request.tool) {
    liveRequest.tool = { name: request.tool.name };
    if (request.tool.title !== undefined) {
      liveRequest.tool.title = request.tool.title;
    }
    if (request.tool.input !== undefined) {
      liveRequest.tool.input = request.tool.input;
    }
  }
  if (request.mutation !== undefined) {
    liveRequest.mutation = request.mutation;
  }
  if (request.supportedReplyOutcomes !== undefined) {
    liveRequest.supportedReplyOutcomes = [...request.supportedReplyOutcomes];
  }
  return liveRequest;
};

const toLivePendingQuestion = (
  request: AgentPendingQuestionRequest,
): AgentSessionLivePendingQuestionRequest => ({
  requestId: request.requestId,
  questions: toCodexToolQuestions(request.questions),
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
    const onLiveSessionMutation = options.onLiveSessionMutation;
    const onCatalogInvalidated = options.onCatalogInvalidated;
    const runtimeEventsDepsBase = {
      respondServerRequest: options.respondServerRequest,
      sessions: {
        get: (externalSessionId: string) => this.localSessions.get(externalSessionId),
        values: () => this.localSessions.values(),
      },
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      sessionEvents: this.sessionEvents,
      pendingInput: this.pendingInput,
      subagents: this.subagents,
      updateThreadStatus: (
        runtimeId: string,
        threadId: string,
        status: CodexThreadStatusSnapshot,
      ) => this.threadInventory.updateThreadStatus(runtimeId, threadId, status),
      flushQueuedUserMessagesLater: (activeTurn: ActiveCodexTurn) =>
        this.flushQueuedUserMessagesLater(activeTurn),
    };
    if (options.subscribeEvents) {
      const runtimeEventsDeps: ConstructorParameters<typeof CodexRuntimeSessionEvents>[0] = {
        ...runtimeEventsDepsBase,
        subscribeEvents: options.subscribeEvents,
        onRuntimeEventQueueFailure: options.onRuntimeEventQueueFailure,
      };
      if (onLiveSessionMutation) {
        runtimeEventsDeps.onLiveSessionMutation = async (mutation) =>
          onLiveSessionMutation({
            ...mutation,
            snapshots: this.listLiveSessionSnapshots(mutation.runtimeId),
          });
      }
      if (onCatalogInvalidated) {
        runtimeEventsDeps.onCatalogInvalidated = onCatalogInvalidated;
      }
      this.runtimeEvents = new CodexRuntimeSessionEvents(runtimeEventsDeps);
    } else {
      const runtimeEventsDeps: ConstructorParameters<typeof CodexRuntimeSessionEvents>[0] = {
        ...runtimeEventsDepsBase,
      };
      if (onLiveSessionMutation) {
        runtimeEventsDeps.onLiveSessionMutation = async (mutation) =>
          onLiveSessionMutation({
            ...mutation,
            snapshots: this.listLiveSessionSnapshots(mutation.runtimeId),
          });
      }
      if (onCatalogInvalidated) {
        runtimeEventsDeps.onCatalogInvalidated = onCatalogInvalidated;
      }
      this.runtimeEvents = new CodexRuntimeSessionEvents(runtimeEventsDeps);
    }
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
    releaseCodexRuntimeState(runtimeId, {
      cancelContextUsage: () => this.contextUsageLoader.cancelRuntime(runtimeId),
      releaseSessions: () => this.localSessions.releaseRuntime(runtimeId),
      clearPendingInput: () => this.pendingInput.clearRuntime(runtimeId),
      clearSubagents: () => this.subagents.clearRuntime(runtimeId),
      clearRuntimeEvents: () => this.runtimeEvents.clearRuntime(runtimeId),
      disposeThreadInventory: () => this.threadInventory.disposeRuntime(runtimeId),
    });
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
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input.sessionScope,
      input.runtimePolicy,
      "start Codex session",
    );
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "start session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const transportModel = toTransportModelSelection(model);
    const policy = sessionPolicy.runtimePolicy;

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
      config: sessionPolicy.threadConfig,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      historyMode: "paginated",
      model: transportModel.model,
    });
    this.clearThreadInventory(runtimeId);
    const title = sessionPolicy.title;
    const session = sessionStateFromThreadStart(input, runtimeId, model, response, title);
    const { summary } = session;
    this.localSessions.remember(session);
    this.runtimeEvents.initializeFreshThreadContextUsage(runtimeId, session.threadId);
    await client.threadSetName({
      threadId: session.threadId,
      name: title,
    });

    return summary;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "resume Codex session");
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input.sessionScope,
      input.runtimePolicy,
      "resume Codex session",
    );
    const current = this.localSessions.get(input.externalSessionId);
    if (current) {
      const currentRef = codexSessionRef(current);
      if (!agentSessionRefsEqual(currentRef, input)) {
        throw new Error(
          `Cannot resume Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${currentRef.repoPath}' and working directory '${currentRef.workingDirectory}'.`,
        );
      }
      assertRuntimeContextCompatibleWithSession(current, input, "resume session");
    }
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "resume session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const policy = sessionPolicy.runtimePolicy;

    this.options.logSessionPolicy?.(
      codexPolicyLogEntry({
        operation: "thread/resume",
        policy,
        runtimeId,
        threadId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      }),
    );
    const threadResumeInput: CodexAppServerThreadResumeParams = {
      ...codexTransportPolicy(policy),
      config: sessionPolicy.threadConfig,
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      excludeTurns: true,
      model: toTransportModelSelection(model).model,
    };
    if (input.systemPrompt) {
      threadResumeInput.developerInstructions = input.systemPrompt;
    }
    const response = await client.threadResume(threadResumeInput);
    this.clearThreadInventory(runtimeId);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    if (sessionPolicy.kind === "repository") {
      session.summary = { ...session.summary, title: sessionPolicy.title };
    }
    const { summary } = session;
    this.localSessions.remember(session);
    if (sessionPolicy.kind === "repository") {
      await client.threadSetName({
        threadId: session.threadId,
        name: sessionPolicy.title,
      });
    }

    return summary;
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "fork Codex session");
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input.sessionScope,
      input.runtimePolicy,
      "fork Codex session",
    );
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "fork session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const policy = sessionPolicy.runtimePolicy;

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
      config: sessionPolicy.threadConfig,
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      excludeTurns: true,
      model: toTransportModelSelection(model).model,
    });
    this.clearThreadInventory(runtimeId);
    const title = sessionPolicy.title;
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
    resolveCodexSessionScopePolicy(
      input.sessionScope,
      input.runtimePolicy,
      "send Codex user message",
    );
    const systemInvocation = classifySystemSlashCommandInvocation(input.parts);
    if (systemInvocation.kind === "not_system") {
      assertCodexUserMessagePartsSupported(input.parts);
    }
    const session = this.policyBoundSession(
      input,
      { lookup: "send", context: "send user message" },
      true,
    );
    return session instanceof Promise
      ? session.then((boundSession) =>
          this.sendUserMessageFromBoundSession(input, boundSession, systemInvocation),
        )
      : this.sendUserMessageFromBoundSession(input, session, systemInvocation);
  }

  private async sendUserMessageFromBoundSession(
    input: SendAgentUserMessageInput,
    session: CodexSessionState,
    systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>,
  ): Promise<AcceptedAgentUserMessage> {
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

  async listAvailableSlashCommands(_input: ListAgentSlashCommandsInput) {
    return slashCommandCatalogSchema.parse({
      commands: [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
    });
  }

  async listAvailableSkills(input: ListAgentSkillsInput): Promise<AgentSkillCatalog> {
    const { client } = await this.runtimeClients.resolve(input, "list available skills");
    const response = await client.skillsList({
      cwds: [input.workingDirectory],
      forceReload: false,
    });
    return toCodexSkillCatalog(response);
  }

  async listAvailableSubagents(_input: ListAgentSubagentsInput) {
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
    const session = await this.policyBoundSession(
      input,
      { lookup: "load history for", context: "load session history" },
      false,
    );
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
    const session = this.policyBoundSession(
      input,
      { lookup: "load context usage for", context: "load session context usage" },
      false,
    );
    return session instanceof Promise
      ? session.then(() => this.contextUsageLoader.loadSession(input))
      : this.contextUsageLoader.loadSession(input);
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
    const session = await this.policyBoundSession(
      input,
      { lookup: "load todos for", context: "load Codex session todos" },
      false,
    );
    const liveTodos = this.runtimeEvents.latestTodos(input.externalSessionId);
    if (liveTodos) {
      return liveTodos;
    }
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

  private policyBoundSession(
    input: PolicyBoundSessionRef,
    actions: { context: string; lookup: string },
    bindMissing: true,
  ): CodexSessionState | Promise<CodexSessionState>;
  private policyBoundSession(
    input: PolicyBoundSessionRef,
    actions: { context: string; lookup: string },
    bindMissing: false,
  ): CodexSessionState | undefined | Promise<CodexSessionState>;
  private policyBoundSession(
    input: PolicyBoundSessionRef,
    actions: { context: string; lookup: string },
    bindMissing: boolean,
  ): CodexSessionState | undefined | Promise<CodexSessionState> {
    const resolution = {
      input,
      actions,
      getSession: (externalSessionId: string) => this.localSessions.get(externalSessionId),
      bindSession: async () => {
        await this.ensureSessionState(input);
        const session = this.localSessions.get(input.externalSessionId);
        if (!session) {
          throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
        }
        return session;
      },
    };
    return bindMissing
      ? resolveCodexPolicyBoundSession({ ...resolution, bindMissing: true })
      : resolveCodexPolicyBoundSession({ ...resolution, bindMissing: false });
  }

  private async ensureSessionState(input: PolicyBoundSessionRef): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "ensure Codex session state");
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "ensure session state");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const model = "model" in input ? (input.model ?? undefined) : undefined;
    if (model) {
      await this.models.validate(client, runtimeId, model);
    }

    const sessionPolicy = resolveCodexSessionScopePolicy(
      input.sessionScope,
      input.runtimePolicy,
      "ensure Codex session state",
    );
    const policy = sessionPolicy.runtimePolicy;
    const threadResumeInput: CodexAppServerThreadResumeParams = {
      ...codexTransportPolicy(policy),
      config: sessionPolicy.threadConfig,
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      excludeTurns: true,
    };
    if ("systemPrompt" in input && input.systemPrompt) {
      threadResumeInput.developerInstructions = input.systemPrompt;
    }
    if (model) {
      threadResumeInput.model = toTransportModelSelection(model).model;
    }
    const response = await client.threadResume(threadResumeInput);
    const session = sessionStateFromExistingThread(input, runtimeId, model, response);
    if (sessionPolicy.kind === "repository") {
      session.summary = { ...session.summary, title: sessionPolicy.title };
    }
    const { summary } = session;
    const existingThreadSession = preserveRuntimeContextForExistingThread(
      session,
      this.localSessions.get(summary.externalSessionId),
    );
    this.localSessions.remember(existingThreadSession);
    if (sessionPolicy.kind === "repository") {
      await client.threadSetName({
        threadId: session.threadId,
        name: sessionPolicy.title,
      });
    }
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
    if (session) {
      this.releaseSessionTree(session);
    } else {
      this.contextUsageLoader.cancelSession(input);
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
    const session = this.policyBoundSession(
      input,
      { lookup: "reply to approval for", context: "reply to approval" },
      true,
    );
    const reply = (boundSession: CodexSessionState) => {
      const approvalReply: CodexLiveApprovalReplyInput = {
        runtimeId: boundSession.runtimeId,
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
        outcome: input.outcome,
      };
      if (input.message !== undefined) {
        approvalReply.message = input.message;
      }
      return this.replyLiveApproval(approvalReply);
    };
    return session instanceof Promise ? session.then(reply) : reply(session);
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
    const session = this.policyBoundSession(
      input,
      { lookup: "reply to question for", context: "reply to question" },
      true,
    );
    const reply = async (boundSession: CodexSessionState): Promise<void> => {
      await this.replyLiveQuestion({
        runtimeId: boundSession.runtimeId,
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
        answers: input.answers,
      });
    };
    return session instanceof Promise ? session.then(reply) : reply(session);
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
        pending.questionIds.map((questionId, index) => {
          const answerSet = input.answers[index];
          if (answerSet === undefined) {
            throw new Error(`Codex question '${questionId}' is missing its answer set.`);
          }
          return [questionId, { answers: answerSet }] as const;
        }),
      );
      const output = JSON.stringify({ answers });
      const questions = toCodexToolQuestions(pending.request.questions);
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
          input: { questions },
          output,
          metadata: {
            codexServerRequest: true,
            requestId: input.requestId,
            questions,
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
    const snapshot: AgentSessionLiveSnapshot = {
      ref: codexSessionRef(session),
      sessionAssociation: session.summary.sessionAssociation,
      activity: classifyAgentSessionActivity({
        runtimeActivity,
        pendingApprovals,
        pendingQuestions,
      }),
      title: session.summary.title ?? session.threadId,
      startedAt: session.summary.startedAt,
      pendingApprovals,
      pendingQuestions,
      contextUsage: this.runtimeEvents.latestContextUsage(session.runtimeId, session.threadId),
    };
    if (route) {
      snapshot.parentExternalSessionId = route.parentExternalSessionId;
    }
    if (session.model) {
      snapshot.model = session.model;
    }
    return agentSessionLiveSnapshotSchema.parse(snapshot);
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
      sessionAssociation: parentSession.summary.sessionAssociation,
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
    const wasRetained = this.localSessions.has(externalSessionId);
    const preparedRuntimeId = !wasRetained
      ? await this.prepareLiveSessionSubscription(input)
      : undefined;

    const session = this.policyBoundSession(
      input,
      { lookup: "subscribe to events for", context: "subscribe session events" },
      false,
    );
    const subscribe = (boundSession: CodexSessionState | undefined) => {
      const registeredSessionRef = boundSession ? codexSessionRef(boundSession) : input;
      const unsubscribe = this.sessionEvents.subscribe(registeredSessionRef, listener);
      for (const { request: approval, route } of this.pendingInput.pendingApprovalEventsForSession(
        externalSessionId,
        boundSession?.runtimeId ?? preparedRuntimeId,
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
        boundSession?.runtimeId ?? preparedRuntimeId,
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
    };
    return session instanceof Promise ? session.then(subscribe) : subscribe(session);
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
      await this.ensureSessionState(input);
      this.clearThreadInventory(runtimeId);
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

    this.releaseSessionTree(session);
  }

  private releaseSessionTree(session: CodexSessionState): void {
    const descendants = this.subagents.descendantRoutesForParent(
      session.threadId,
      session.runtimeId,
      (route) => {
        const child = this.localSessions.get(route.childExternalSessionId);
        return (
          !child ||
          (child.runtimeId === session.runtimeId && child.contextOwnerThreadId !== undefined)
        );
      },
    );
    for (const route of descendants.toReversed()) {
      this.contextUsageLoader.cancelSession({
        ...codexSessionRef(session),
        externalSessionId: route.childExternalSessionId,
      });
      if (this.localSessions.has(route.childExternalSessionId)) {
        this.localSessions.release(route.childExternalSessionId);
      }
    }
    this.contextUsageLoader.cancelSession(codexSessionRef(session));
    this.localSessions.release(session.threadId);
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
    const context: CodexTurnLifecycleContext = {
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
    };
    if (this.options.logSessionPolicy) {
      context.logSessionPolicy = this.options.logSessionPolicy;
    }
    return context;
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    const session = this.localSessions.get(input.externalSessionId);
    const runtimeId = session
      ? session.runtimeId
      : (await this.runtimeClients.resolve(input, "load Codex session diff")).runtimeId;
    const diff = this.runtimeEvents.sessionDiff(
      runtimeId,
      input.externalSessionId,
      input.runtimeHistoryAnchor,
    );
    return fileDiffsFromUnifiedDiff(diff);
  }

  async loadFileStatus(
    _input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return unsupported("loadFileStatus");
  }
}
