import { InterruptedTurnResumeError } from "@openducktor/core";
import {
  assertAgentWorkStartCurrent,
  markAgentWorkIssued,
  markAgentWorkAccepted,
} from "@openducktor/core";
import { listCodexSessionMetadataPage, getCodexSessionMetadata } from "./codex-session-metadata";
import type { RuntimeSessionImportSource } from "@openducktor/core";
import { codexSubAgentSourceMetadata } from "./codex-app-server-threads";
import {
  AgentRuntimeQueryError,
  AgentSessionTurnActiveError,
  assertAgentRuntimeQuerySession,
  withSummaryTitle,
} from "@openducktor/core";
import type {
  AgentGeneratedImageBatch,
  AgentGeneratedImageBatchInput,
  AgentGeneratedImageDescribeInput,
  AgentSessionControlUpdateTitleInput,
} from "@openducktor/contracts";
import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import { CodexGeneratedImageResolver } from "./codex-generated-image-resolver";
import {
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveSnapshot,
  type CodexAppServerThreadResumeParams,
  agentSessionLiveSnapshotSchema,
  isAgentSessionTranscriptEventType,
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
  AgentRuntimeCatalogRead,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentSessionTitleUpdateResult,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ContinueInterruptedAgentTurnInput,
  ForkAgentSessionInput,
  LoadAgentRuntimeCatalogInput,
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
  readCatalogSurface,
  withAgentSessionRef,
} from "@openducktor/core";
import { requireCodexPendingRequestKey } from "./codex-app-server-approvals";
import { codexApprovalResponseForRequest } from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  isCodexThreadNotLoadedError,
  unsupported,
} from "./codex-app-server-shared";
import { createCodexAcceptedUserMessage } from "./codex-app-server-streaming";
import { interruptedTurnResumeError } from "@openducktor/core";
import type { CodexThreadInventory, CodexThreadStatusSnapshot } from "./codex-app-server-threads";
import { codexTodosFromThreadRead } from "./codex-app-server-transcript";
import { CodexContextUsageLoader } from "./codex-context-usage-loader";
import { fileDiffsFromUnifiedDiff } from "./codex-file-diffs";
import { CodexLocalSessionState } from "./codex-local-session-state";
import { CodexMessageAcceptedError } from "./codex-message-accepted-error";
import { CodexFirstTurnHistory } from "./codex-first-turn-history";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexQuestionHistory } from "./codex-question-history";
import { CodexAsyncQuestionState } from "./codex-async-questions";
import { findRetainedSessionOwner } from "./codex-retained-session-owner";
import { releaseCodexRuntimeState } from "./codex-runtime-cleanup";
import { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { loadCodexSessionHistory } from "./codex-session-history";
import { prepareCodexReplyForkChild, resolveCodexReplyForkBoundary } from "./codex-reply-fork";
import {
  assertCodexSessionRef,
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
import {
  type CodexSessionScopePolicy,
  resolveCodexSessionScopePolicy,
} from "./codex-session-scope-policy";
import { type CodexThreadConfig, resolveCodexThreadConfig } from "./codex-managed-mcp";
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
  runningTurnOf,
  startCodexContinuationTurn,
  sendCodexUserMessage,
  sendCodexQuestionReply,
} from "./codex-turn-lifecycle";
import {
  assertCodexUserMessagePartsSupported,
  toCodexAsyncQuestionReplyInput,
} from "./codex-user-inputs";
import { codexAsyncQuestionReplyText, codexAsyncQuestionReplyTools } from "./codex-async-questions";
import { searchCodexFiles } from "./file-search";
import {
  CodexModels,
  requireModelSelection,
  toCatalog,
  toTransportModelSelection,
} from "./model-catalog";
import { toCodexSkillCatalog } from "./skill-catalog";
import type {
  CodexAppServerClient,
  CodexAppServerAdapterOptions,
  CodexLiveApprovalReplyInput,
  CodexLiveQuestionReplyInput,
  CodexLiveSessionLocator,
  CodexServerRequestResponder,
  CodexSessionContextUsage,
  CodexSessionState,
  CodexThreadResumeResult,
  CodexThreadForkParams,
} from "./types";
import { readCodexSubagentRole } from "./codex-subagent-role";

export { createCodexAppServerClient } from "./app-server-client";

const codexContinuationFailed = (
  externalSessionId: string,
  cause: unknown,
  nativeOutcome?: "accepted" | "uncertain" | "not_issued",
) =>
  interruptedTurnResumeError({
    reason: "continuation_failed",
    ...(cause instanceof InterruptedTurnResumeError && cause.nativeOutcome
      ? { nativeOutcome: cause.nativeOutcome }
      : nativeOutcome
        ? { nativeOutcome }
        : {}),
    message: `Codex could not continue the interrupted turn for session '${externalSessionId}': ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

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
): AgentSessionLivePendingQuestionRequest => {
  const liveRequest: AgentSessionLivePendingQuestionRequest = {
    requestId: request.requestId,
    questions: toCodexToolQuestions(request.questions),
  };
  if (request.requestInstanceId !== undefined) {
    liveRequest.requestInstanceId = request.requestInstanceId;
  }
  if (request.blocking !== undefined) {
    liveRequest.blocking = request.blocking;
  }
  return liveRequest;
};

type CodexSendOptions = { onSent?: () => void; assertCurrent?: (() => void) | undefined };

export class CodexAppServerAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly runtimeClients: CodexRuntimeClientResolver;
  private readonly sessionEvents = new CodexSessionEventBus();
  private readonly pendingInput = new CodexPendingInputState();
  private readonly asyncQuestions = new CodexAsyncQuestionState();
  private readonly questionHistory: CodexQuestionHistory;
  private readonly activeTurnsBySessionId = new Map<string, ActiveCodexTurn>();
  private readonly freshTitleState = new WeakMap<CodexSessionState, "pending" | "tried">();
  private readonly localSessions: CodexLocalSessionState;
  private readonly contextUsageLoader: CodexContextUsageLoader;
  private readonly runtimeEvents: CodexRuntimeSessionEvents;
  private readonly models = new CodexModels();
  private readonly threadInventory: CodexThreadInventoryReader;
  private readonly generatedImages: CodexGeneratedImageResolver;
  private readonly subagents = new CodexSubagentLinkState();

  constructor(private readonly options: CodexAppServerAdapterOptions) {
    this.questionHistory = options.questionHistory ?? new CodexQuestionHistory();
    this.runtimeClients = new CodexRuntimeClientResolver(options);
    this.threadInventory = new CodexThreadInventoryReader(options.directoriesMatch);
    this.generatedImages = new CodexGeneratedImageResolver(
      this.runtimeClients,
      this.threadInventory,
      options.directoriesMatch,
      options.prepareImageGenerations,
    );
    const onLiveSessionMutation = options.onLiveSessionMutation;
    const onCatalogInvalidated = options.onCatalogInvalidated;
    const runtimeEventsDepsBase: Omit<
      ConstructorParameters<typeof CodexRuntimeSessionEvents>[0],
      "subscribeEvents" | "onRuntimeEventQueueFailure"
    > = {
      prepareImageGenerations: options.prepareImageGenerations,
      respondServerRequest: options.respondServerRequest,
      resolveWorkflowRolePolicy: options.resolveWorkflowRolePolicy,
      sessions: {
        get: (externalSessionId: string) => this.localSessions.get(externalSessionId),
        values: () => this.localSessions.values(),
      },
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      sessionEvents: this.sessionEvents,
      pendingInput: this.pendingInput,
      asyncQuestions: this.asyncQuestions,
      subagents: this.subagents,
      readSubagentRole: (runtimeId, childThreadId, scope) =>
        readCodexSubagentRole(
          this.runtimeClients.clientForRuntime(runtimeId),
          childThreadId,
          scope,
        ),
      updateThreadStatus: (
        runtimeId: string,
        threadId: string,
        status: CodexThreadStatusSnapshot,
      ) => this.threadInventory.updateThreadStatus(runtimeId, threadId, status),
    };
    if (onLiveSessionMutation) {
      runtimeEventsDepsBase.onLiveSessionMutation = ({ changedSessionIds, ...mutation }) =>
        onLiveSessionMutation({
          ...mutation,
          snapshotMode: "delta",
          removedRefs: [],
          snapshots: this.changedLiveSessionSnapshots(mutation.runtimeId, changedSessionIds),
        });
    }
    if (options.subscribeEvents) {
      const runtimeEventsDeps: ConstructorParameters<typeof CodexRuntimeSessionEvents>[0] = {
        ...runtimeEventsDepsBase,
        subscribeEvents: options.subscribeEvents,
        onRuntimeEventQueueFailure: options.onRuntimeEventQueueFailure,
      };
      if (onCatalogInvalidated) {
        runtimeEventsDeps.onCatalogInvalidated = onCatalogInvalidated;
      }
      this.runtimeEvents = new CodexRuntimeSessionEvents(runtimeEventsDeps);
    } else {
      const runtimeEventsDeps: ConstructorParameters<typeof CodexRuntimeSessionEvents>[0] = {
        ...runtimeEventsDepsBase,
      };
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
      threadConfig: (repoPath, sessionPolicy) => this.threadConfig(repoPath, sessionPolicy),
      clearThreadInventory: (runtimeId) => this.clearThreadInventory(runtimeId),
      resolveWorkflowRolePolicy: this.options.resolveWorkflowRolePolicy,
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
    this.generatedImages.prepareRuntime(runtimeId);
  }

  resolveGeneratedImageSource(
    input: AgentGeneratedImageReadInput,
    signal?: AbortSignal,
  ): Promise<AgentGeneratedImageSource> {
    return this.generatedImages.resolve(input, signal);
  }

  beginGeneratedImageBatch(input: AgentGeneratedImageBatchInput, signal?: AbortSignal) {
    return this.generatedImages.beginBatch(input, signal);
  }

  releaseGeneratedImageBatch(input: AgentGeneratedImageBatch): void {
    this.generatedImages.releaseImageBatch(input);
  }

  describeGeneratedImages(input: AgentGeneratedImageDescribeInput, signal?: AbortSignal) {
    return this.generatedImages.describe(input, signal);
  }

  settleGeneratedImages(runtimeId: string, sessionRef?: SessionRef): AgentEvent[] {
    return this.runtimeEvents.settleGeneratedImages(runtimeId, sessionRef);
  }

  releaseRuntime(runtimeId: string): void {
    this.generatedImages.releaseRuntime(runtimeId);
    releaseCodexRuntimeState(runtimeId, {
      cancelContextUsage: () => this.contextUsageLoader.cancelRuntime(runtimeId),
      releaseSessions: () => {
        this.settleGeneratedImages(runtimeId);
        this.localSessions.releaseRuntime(runtimeId);
      },
      clearPendingInput: () => this.pendingInput.clearRuntime(runtimeId),
      clearAsyncQuestions: () => this.asyncQuestions.clearRuntime(runtimeId),
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

  /** Binds the managed MCP server of the session's workspace to one thread request. */
  private threadConfig(
    repoPath: string,
    sessionPolicy: Pick<CodexSessionScopePolicy, "enabledTools">,
  ): Promise<CodexThreadConfig> {
    return resolveCodexThreadConfig(
      this.options.resolveManagedMcpServer,
      repoPath,
      sessionPolicy.enabledTools,
    );
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
      input,
      "start Codex session",
      this.options.resolveWorkflowRolePolicy,
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
    const config = await this.threadConfig(input.repoPath, sessionPolicy);
    assertAgentWorkStartCurrent(input);
    const response = await client.threadStart({
      ...codexTransportPolicy(policy),
      config,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      historyMode: "paginated",
      model: transportModel.model,
    });
    this.clearThreadInventory(runtimeId);
    const title = sessionPolicy.title;
    const session = sessionStateFromThreadStart(
      input,
      runtimeId,
      model,
      response,
      sessionPolicy.kind === "repository" ? undefined : title,
    );
    const { summary } = session;
    session.firstTurnHistory = new CodexFirstTurnHistory();
    this.localSessions.remember(session);
    if (sessionPolicy.kind === "repository") this.freshTitleState.set(session, "pending");
    this.runtimeEvents.initializeFreshThread(runtimeId, session.threadId);
    if (title !== undefined && sessionPolicy.kind !== "repository") {
      await client.threadSetName({
        threadId: session.threadId,
        name: title,
      });
    }

    return summary;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "resume Codex session");
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input,
      "resume Codex session",
      this.options.resolveWorkflowRolePolicy,
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
      if (
        current.summary.sessionAssociation.kind !== "unbound" &&
        (this.freshTitleState.get(current) !== "tried" ||
          runningTurnOf(this.activeTurnsBySessionId, current.threadId) !== null)
      ) {
        assertAgentWorkStartCurrent(input);
        markAgentWorkAccepted(input);
        if (sessionPolicy.kind === "repository") {
          await this.applyRepositoryTitle(input, current, sessionPolicy.title, {
            tolerateFailure: true,
          });
          return { ...current.summary, firstTurnCompleted: !this.freshTitleState.has(current) };
        }
        return current.summary;
      }
    }
    if (
      sessionPolicy.kind === "repository" &&
      !input.systemPrompt &&
      (!current || current.preserveNativeSettings)
    ) {
      if (current) {
        const { client, runtimeId } = await this.runtimeClients.resolve(input, "resume session");
        await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
        const config = await this.threadConfig(input.repoPath, sessionPolicy);
        assertAgentWorkStartCurrent(input);
        markAgentWorkIssued(input);
        const response = await client.threadResume({
          config,
          threadId: input.externalSessionId,
          excludeTurns: true,
        });
        if (
          response.thread.id !== input.externalSessionId ||
          !(await this.options.directoriesMatch(response.cwd, input.workingDirectory))
        )
          throw new Error("Codex resumed a different conversation or directory.");
        markAgentWorkAccepted(input);
        const previousTitleState = this.freshTitleState.get(current);
        this.freshTitleState.set(current, "pending");
        let firstTurnCompleted: boolean;
        try {
          firstTurnCompleted = await this.readFirstTurnCompleted(
            client,
            response,
            input.externalSessionId,
          );
        } catch (cause) {
          if (previousTitleState === undefined) this.freshTitleState.delete(current);
          else this.freshTitleState.set(current, previousTitleState);
          throw cause;
        }
        if (firstTurnCompleted) this.freshTitleState.delete(current);
        await this.applyRepositoryTitle(input, current, sessionPolicy.title, {
          tolerateFailure: true,
        });
        return { ...current.summary, firstTurnCompleted };
      }
      const { client, response, session } = await this.resumeExistingThread(input);
      markAgentWorkAccepted(input);
      this.localSessions.remember(session);
      this.freshTitleState.set(session, "pending");
      let firstTurnCompleted: boolean;
      try {
        firstTurnCompleted = await this.readFirstTurnCompleted(
          client,
          response,
          input.externalSessionId,
        );
      } catch (cause) {
        this.localSessions.release(session.threadId);
        throw cause;
      }
      if (firstTurnCompleted) this.freshTitleState.delete(session);
      await this.applyRepositoryTitle(input, session, sessionPolicy.title, {
        tolerateFailure: true,
      });
      return { ...session.summary, firstTurnCompleted };
    }
    if (!input.model) {
      const session = await this.ensureSessionState(input);
      markAgentWorkAccepted(input);
      return session;
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
      config: await this.threadConfig(input.repoPath, sessionPolicy),
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
      excludeTurns: true,
      model: toTransportModelSelection(model).model,
    };
    const checkFirstTurn =
      sessionPolicy.kind === "repository" &&
      (!current || this.freshTitleState.get(current) === "pending");
    if (input.systemPrompt) {
      threadResumeInput.developerInstructions = input.systemPrompt;
    }
    assertAgentWorkStartCurrent(input);
    markAgentWorkIssued(input);
    const response = await client.threadResume(threadResumeInput);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    markAgentWorkAccepted(input);
    if (!current) this.localSessions.remember(session);
    if (checkFirstTurn) this.freshTitleState.set(session, "pending");
    let firstTurnCompleted = true;
    try {
      if (checkFirstTurn)
        firstTurnCompleted = await this.readFirstTurnCompleted(
          client,
          response,
          input.externalSessionId,
        );
    } catch (cause) {
      if (!current) this.localSessions.release(session.threadId);
      throw cause;
    }
    this.clearThreadInventory(runtimeId);
    const repositoryTitle = sessionPolicy.kind === "repository" ? sessionPolicy.title : undefined;
    this.localSessions.remember(session);
    if (firstTurnCompleted) this.freshTitleState.delete(session);
    await this.applyRepositoryTitle(input, session, repositoryTitle);

    return sessionPolicy.kind === "repository"
      ? { ...session.summary, firstTurnCompleted }
      : session.summary;
  }

  async continueInterruptedTurn(
    input: ContinueInterruptedAgentTurnInput,
  ): Promise<AgentSessionSummary> {
    assertCodexRuntimePolicyBinding(input, "continue Codex turn");
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input,
      "continue Codex turn",
      this.options.resolveWorkflowRolePolicy,
    );
    const current = this.localSessions.get(input.externalSessionId);
    if (current) {
      const currentRef = codexSessionRef(current);
      if (!agentSessionRefsEqual(currentRef, input)) {
        throw interruptedTurnResumeError({
          reason: "identity_mismatch",
          message: `Codex session '${input.externalSessionId}' is registered to repo '${currentRef.repoPath}' and working directory '${currentRef.workingDirectory}'.`,
        });
      }
      assertRuntimeContextCompatibleWithSession(current, input, "continue Codex turn", (message) =>
        interruptedTurnResumeError({ reason: "identity_mismatch", message }),
      );
    }
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "continue Codex turn");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);

    let thread: Awaited<ReturnType<typeof client.threadRead>>["thread"];
    try {
      ({ thread } = await client.threadRead({
        threadId: input.externalSessionId,
        includeTurns: true,
      }));
    } catch (cause) {
      if (isCodexThreadNotLoadedError(cause)) {
        throw interruptedTurnResumeError({
          reason: "session_not_found",
          message: `Codex thread '${input.externalSessionId}' no longer exists on the runtime.`,
          cause,
        });
      }
      throw interruptedTurnResumeError({
        reason: "probe_failed",
        message: `Cannot read the Codex thread for session '${input.externalSessionId}': ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
    }
    if (
      thread.id !== input.externalSessionId ||
      !(await this.options.directoriesMatch(thread.cwd, input.workingDirectory))
    ) {
      throw interruptedTurnResumeError({
        reason: "identity_mismatch",
        message: `Codex thread '${input.externalSessionId}' does not match the stored working directory '${input.workingDirectory}'.`,
      });
    }
    if (thread.status.type === "active" && thread.status.activeFlags.length > 0) {
      throw interruptedTurnResumeError({
        reason: "waiting_input",
        message: `Codex session '${input.externalSessionId}' is waiting for ${thread.status.activeFlags.join(" and ")}.`,
      });
    }
    if (thread.status.type === "active") {
      throw interruptedTurnResumeError({
        reason: "live_turn",
        message: `Codex session '${input.externalSessionId}' has a live turn.`,
      });
    }
    const liveSnapshot = this.listLiveSessionSnapshots(runtimeId).find(
      (snapshot) => snapshot.ref.externalSessionId === input.externalSessionId,
    );
    if (
      liveSnapshot &&
      (liveSnapshot.pendingApprovals.length > 0 || liveSnapshot.pendingQuestions.length > 0)
    ) {
      throw interruptedTurnResumeError({
        reason: "waiting_input",
        message: `Codex session '${input.externalSessionId}' is waiting for a pending approval or question.`,
      });
    }
    const latestTurn = thread.turns.at(-1);
    if (!latestTurn) {
      throw interruptedTurnResumeError({
        reason: "ineligible_turn_state",
        message: `Codex session '${input.externalSessionId}' has no turn to continue.`,
      });
    }
    if (latestTurn.status === "completed") {
      throw interruptedTurnResumeError({
        reason: "completed_turn",
        message: `Codex session '${input.externalSessionId}' has a completed latest turn.`,
      });
    }
    if (latestTurn.status === "inProgress") {
      throw interruptedTurnResumeError({
        reason: "live_turn",
        message: `Codex session '${input.externalSessionId}' has a live turn.`,
      });
    }

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
    const preserveNativeSettings = current?.preserveNativeSettings === true;
    // Preserved native settings keep the thread policy, but the managed MCP server is always bound.
    const config = await this.threadConfig(input.repoPath, sessionPolicy);
    const threadResumeInput: CodexAppServerThreadResumeParams = preserveNativeSettings
      ? { config, threadId: input.externalSessionId, excludeTurns: true }
      : {
          ...codexTransportPolicy(policy),
          config,
          threadId: input.externalSessionId,
          cwd: input.workingDirectory,
          excludeTurns: true,
          model: toTransportModelSelection(model).model,
        };
    if (input.systemPrompt && !preserveNativeSettings) {
      threadResumeInput.developerInstructions = input.systemPrompt;
    }
    assertAgentWorkStartCurrent(input);
    const response = await client.threadResume(threadResumeInput);
    this.clearThreadInventory(runtimeId);
    const session = sessionStateFromThreadResume(input, runtimeId, model, response);
    session.preserveNativeSettings = preserveNativeSettings;
    const repositoryTitle = sessionPolicy.kind === "repository" ? sessionPolicy.title : undefined;
    try {
      // A replacement that cannot be prepared must not stay registered as a live
      // session, or the host would show a running session without a consumer.
      await this.applyRepositoryTitle(input, session, repositoryTitle);
    } catch (cause) {
      throw codexContinuationFailed(input.externalSessionId, cause);
    }
    this.localSessions.remember(session);
    let continuationIssued = false;
    const continuationContext = this.turnLifecycleContext();
    continuationContext.assertCurrent = () => input.workStartGuard?.assertCurrent();
    continuationContext.systemPrompt = input.systemPrompt;
    continuationContext.onSent = () => {
      continuationIssued = true;
      markAgentWorkIssued(input);
    };
    try {
      await startCodexContinuationTurn(continuationContext, input.externalSessionId, model);
      markAgentWorkAccepted(input);
    } catch (cause) {
      throw codexContinuationFailed(
        input.externalSessionId,
        cause,
        continuationIssued ? "uncertain" : "not_issued",
      );
    }
    return session.summary;
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    if (input.forkPoint && input.runtimeHistoryAnchor !== undefined) {
      throw new Error("Select one Codex fork point. Do not combine a reply with a history anchor.");
    }
    assertCodexRuntimePolicyBinding(input, "fork Codex session");
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input,
      "fork Codex session",
      this.options.resolveWorkflowRolePolicy,
    );
    const model = requireModelSelection(input.model);
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "fork session");
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    await this.models.validate(client, runtimeId, model);
    const source = input.forkPoint
      ? await this.threadInventory.readThreadHistory(client, {
          externalSessionId: input.parentExternalSessionId,
          workingDirectory: input.sourceWorkingDirectory ?? input.workingDirectory,
        })
      : undefined;
    const replyBoundary =
      source && input.forkPoint
        ? resolveCodexReplyForkBoundary(source, input.forkPoint.messageId)
        : undefined;
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
    const config = await this.threadConfig(input.repoPath, sessionPolicy);
    assertAgentWorkStartCurrent(input);
    const request: CodexThreadForkParams = {
      ...codexTransportPolicy(policy),
      config,
      threadId: input.parentExternalSessionId,
      cwd: input.workingDirectory,
      developerInstructions: input.systemPrompt,
      excludeTurns: true,
      model: toTransportModelSelection(model).model,
    };
    if (replyBoundary) {
      request.lastTurnId = replyBoundary.lastTurnId;
      request.deferGoalContinuation = true;
    }
    const response = await client.threadFork(request);
    const childThreadId = response.thread.id;
    const isRegistered = this.localSessions.has(childThreadId);
    const ownsReplyFork =
      replyBoundary !== undefined &&
      childThreadId !== input.parentExternalSessionId &&
      !isRegistered &&
      response.thread.forkedFromId === input.parentExternalSessionId;
    try {
      this.clearThreadInventory(runtimeId);
      const preparedResponse = replyBoundary
        ? await prepareCodexReplyForkChild({
            client,
            threadInventory: this.threadInventory,
            response,
            parentThreadId: input.parentExternalSessionId,
            workingDirectory: input.workingDirectory,
            boundary: replyBoundary,
            isRegistered,
          })
        : response;
      const title = sessionPolicy.title;
      const session = sessionStateFromThreadFork(input, runtimeId, model, preparedResponse, title);
      if (title !== undefined) {
        await client.threadSetName({
          threadId: session.threadId,
          name: title,
        });
        session.nativeName = title;
      }
      this.localSessions.remember(session);

      return session.summary;
    } catch (cause) {
      if (!ownsReplyFork) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      const failureMessage = `${message} The fork '${childThreadId}' remains in Codex history and is not registered in OpenDucktor. Inspect this fork before retrying.`;
      try {
        this.localSessions.release(childThreadId);
      } catch (cleanupCause) {
        const cleanupMessage =
          cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause);
        throw new AggregateError(
          [cause, cleanupCause],
          `${failureMessage} Could not release its local state: ${cleanupMessage}`,
          { cause },
        );
      }
      throw new Error(failureMessage, { cause });
    }
  }

  /**
   * The send resolves only after Codex admits the message. `onSent` runs when the native request
   * that carries the message goes to Codex.
   */
  async sendUserMessage(
    input: SendAgentUserMessageInput,
    options: CodexSendOptions = {},
  ): Promise<AcceptedAgentUserMessage> {
    assertCodexRuntimePolicyBinding(input, "send Codex user message");
    const scopePolicy = resolveCodexSessionScopePolicy(
      input,
      "send Codex user message",
      this.options.resolveWorkflowRolePolicy,
    );
    const systemInvocation = classifySystemSlashCommandInvocation(input.parts);
    if (systemInvocation.kind === "not_system") {
      assertCodexUserMessagePartsSupported(input.parts);
    }
    const current = this.localSessions.get(input.externalSessionId);
    if (!current || current.summary.sessionAssociation.kind === "unbound")
      throw new Error("The Codex session is not attached. Reopen the chat before sending.");
    const session = await this.policyBoundSession(
      {
        repoPath: input.repoPath,
        runtimeKind: "codex",
        runtimePolicy: { kind: "codex", policy: scopePolicy.runtimePolicy },
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        sessionScope: input.sessionScope,
        systemPrompt: input.systemPrompt,
      },
      { lookup: "send", context: "send user message" },
      false,
    );
    if (!session) throw new Error("The Codex session closed before sending. Reopen the chat.");
    return this.sendUserMessageFromBoundSession(input, session, systemInvocation, options);
  }

  private async sendUserMessageFromBoundSession(
    input: SendAgentUserMessageInput,
    session: CodexSessionState,
    systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>,
    options: CodexSendOptions,
  ): Promise<AcceptedAgentUserMessage> {
    let resolvedQuestionRequestIds: readonly string[];
    if (systemInvocation.kind === "manual_session_compaction") {
      resolvedQuestionRequestIds = [];
    } else if (input.resolvedQuestionRequestIds !== undefined) {
      resolvedQuestionRequestIds = input.resolvedQuestionRequestIds;
    } else {
      resolvedQuestionRequestIds = this.asyncQuestions
        .pendingForSession(session.runtimeId, session.threadId)
        .map((request) => request.requestId);
    }
    const acceptedUserMessage = createCodexAcceptedUserMessage({
      session,
      parts: input.parts,
      model: session.model ?? undefined,
      resolvedQuestionRequestIds,
      submissionId: input.submissionId,
    });
    if (systemInvocation.kind === "manual_session_compaction") {
      // Compaction is its own native operation, so it never joins running work.
      if (runningTurnOf(this.activeTurnsBySessionId, session.threadId)) {
        throw new AgentSessionTurnActiveError(session.threadId);
      }
      await this.runtimeEvents.ensureRuntimeEventSubscription(session.runtimeId);
      const client = this.runtimeClients.clientForRuntime(session.runtimeId);
      try {
        options.assertCurrent?.();
        const compacting = client.threadCompactStart({ threadId: session.threadId });
        options.onSent?.();
        await compacting;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Codex failed to compact thread '${session.threadId}': ${message}`);
      }
      return acceptedUserMessage;
    }
    const context = this.turnLifecycleContext();
    if (options.onSent) context.onSent = options.onSent;
    context.assertCurrent = options.assertCurrent ?? input.workStartGuard?.assertCurrent;
    context.systemPrompt = input.delivery === "new_turn" ? input.systemPrompt : undefined;
    const accepted = await sendCodexUserMessage(
      context,
      input.externalSessionId,
      input.parts,
      acceptedUserMessage,
      input.delivery,
      resolvedQuestionRequestIds,
    );
    this.asyncQuestions.resolve(session.runtimeId, session.threadId, resolvedQuestionRequestIds);
    return accepted;
  }

  async loadRuntimeCatalog(input: LoadAgentRuntimeCatalogInput): Promise<AgentRuntimeCatalogRead> {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "load runtime catalog");
    const readModels = async (): Promise<AgentModelCatalog> =>
      toCatalog(await this.models.list(client, runtimeId));
    const readSlashCommands = async (): Promise<AgentSlashCommandCatalog> =>
      slashCommandCatalogSchema.parse({
        commands: [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
      });
    const readSkills = async (): Promise<AgentSkillCatalog> => {
      const response = await client.skillsList({
        cwds: [input.workingDirectory],
        forceReload: false,
      });
      return toCodexSkillCatalog(response);
    };

    const [models, slashCommands, skills] = await Promise.all([
      readCatalogSurface(readModels),
      readCatalogSurface(readSlashCommands),
      readCatalogSurface(readSkills),
    ]);

    return {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models,
      slashCommands,
      skills,
    };
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
    const runtime = await this.runtimeClients.resolve(input, "load Codex session history");
    const session = this.querySession(input, runtime.runtimeId);
    const mergeImage = this.options.subscribeEvents
      ? this.runtimeEvents.prepareImageHistory(runtime.runtimeId, input.externalSessionId)
      : undefined;
    const nativeHistory = await loadCodexSessionHistory({
      input,
      session,
      runtime,
      threadInventory: this.threadInventory,
      readRunningTurnModel: (threadId, turnId) =>
        this.runtimeEvents.readRunningTurnModel(runtime.runtimeId, threadId, turnId),
      prepareImageGenerations: this.options.prepareImageGenerations,
    });
    const history = this.questionHistory.merge(
      runtime.runtimeId,
      input.externalSessionId,
      nativeHistory,
    );
    const questionsChanged = this.asyncQuestions.loadHistory(
      runtime.runtimeId,
      input.externalSessionId,
      history,
    );
    if (questionsChanged && session && this.options.onLiveSessionMutation) {
      await this.options.onLiveSessionMutation({
        provenance: "baseline",
        runtimeId: runtime.runtimeId,
        snapshotMode: "delta",
        removedRefs: [],
        snapshots: this.changedLiveSessionSnapshots(
          runtime.runtimeId,
          new Set([input.externalSessionId]),
        ),
        transcriptEvents: [],
        catalogInvalidated: false,
      });
    }
    if (!mergeImage) return history;
    return history.map((message) =>
      message.role === "assistant"
        ? {
            ...message,
            parts: message.parts.map((part) =>
              part.kind === "image_generation"
                ? mergeImage(part, message.timestampIsApproximate ? undefined : message.timestamp)
                : part,
            ),
          }
        : message,
    );
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

  private changedLiveSessionSnapshots(
    runtimeId: string,
    changedSessionIds: ReadonlySet<string>,
  ): AgentSessionLiveSnapshot[] {
    const snapshots: AgentSessionLiveSnapshot[] = [];
    for (const threadId of changedSessionIds) {
      const owner = findRetainedSessionOwner({
        sessions: this.localSessions,
        subagents: this.subagents,
        runtimeId,
        threadId,
      });
      if (owner) {
        snapshots.push(
          owner.route
            ? this.toRoutedChildLiveSessionSnapshot(owner.retainedSession, owner.route)
            : this.toLiveSessionSnapshot(owner.retainedSession),
        );
      }
    }
    return snapshots;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    assertCodexRuntimePolicyBinding(input, "load Codex session todos");
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "load Codex session todos",
    );
    this.querySession(input, runtimeId);
    const liveTodos = this.runtimeEvents.latestTodos(input.externalSessionId);
    if (liveTodos !== undefined) return liveTodos;
    const response = await this.threadInventory.readThreadHistory(client, {
      externalSessionId: input.externalSessionId,
      workingDirectory: input.workingDirectory,
    });
    const historyTodos = codexTodosFromThreadRead(response);
    const latestLiveTodos = this.runtimeEvents.latestTodos(input.externalSessionId);
    return latestLiveTodos ?? historyTodos;
  }

  /** Reads a thread without its turns and checks that it is the selected session. */
  private async readScopedThread(client: CodexAppServerClient, input: SessionRef) {
    const { thread } = await client.threadRead({
      threadId: input.externalSessionId,
      includeTurns: false,
    });
    if (
      thread.id !== input.externalSessionId ||
      !(await this.options.directoriesMatch(thread.cwd, input.workingDirectory))
    ) {
      throw new AgentRuntimeQueryError(
        "scope_mismatch",
        "The native session does not match the selected session and working directory. Select the matching session.",
      );
    }
    return thread;
  }

  async resolveSessionParent(input: SessionRef): Promise<string | null> {
    const { client } = await this.runtimeClients.resolve(input, "read session parent");
    const thread = await this.readScopedThread(client, input);
    const sourceParent = codexSubAgentSourceMetadata(thread.source)?.parentThreadId;
    if (sourceParent && thread.parentThreadId && sourceParent !== thread.parentThreadId) {
      throw new AgentRuntimeQueryError(
        "invalid_runtime_response",
        "The native session has conflicting parent identities. Check the host runtime logs.",
      );
    }
    return thread.parentThreadId ?? sourceParent ?? null;
  }

  private querySession(
    input: SessionRef & {
      sessionScope?: import("@openducktor/contracts").AgentSessionScope | undefined;
    },
    runtimeId: string,
  ): CodexSessionState | undefined {
    const session = this.localSessions.get(input.externalSessionId);
    if (session && session.runtimeId !== runtimeId) {
      throw new AgentRuntimeQueryError(
        "runtime_unavailable",
        "The session belongs to a replaced runtime. Reload the runtime data.",
      );
    }
    const owner = findRetainedSessionOwner({
      sessions: this.localSessions,
      subagents: this.subagents,
      runtimeId,
      threadId: input.externalSessionId,
    });
    if (owner) {
      assertAgentRuntimeQuerySession(
        input,
        {
          repoPath: owner.retainedSession.repoPath,
          runtimeKind: "codex",
          workingDirectory: owner.retainedSession.workingDirectory,
          externalSessionId: input.externalSessionId,
        },
        owner.retainedSession.summary.sessionAssociation,
      );
    }
    return session;
  }

  /** Lists native root sessions of every directory. The caller filters by repository. */
  async listSessionMetadataPage(input: {
    runtimeId: string;
    pageToken?: string;
    signal: AbortSignal;
  }) {
    return listCodexSessionMetadataPage(
      this.runtimeClients.clientForRuntime(input.runtimeId),
      input,
    );
  }

  async openExistingSession(input: PolicyBoundSessionRef): Promise<RuntimeSessionImportSource> {
    const { metadata, session } = await this.resumeExistingThread(input);
    return {
      metadata,
      selectedModel: session.model ? { ...session.model, runtimeKind: "codex" } : null,
      attach: async () => {
        this.localSessions.remember(session);
      },
    };
  }

  private async resumeExistingThread(input: PolicyBoundSessionRef) {
    const { client, runtimeId } = await this.runtimeClients.resolve(input, "open existing session");
    const metadata = await getCodexSessionMetadata(client, input, this.options.directoriesMatch);
    await this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId);
    const sessionPolicy = resolveCodexSessionScopePolicy(
      input,
      "open existing Codex session",
      this.options.resolveWorkflowRolePolicy,
    );
    const config = await this.threadConfig(input.repoPath, sessionPolicy);
    assertAgentWorkStartCurrent(input);
    markAgentWorkIssued(input);
    const response = await client.threadResume({
      config,
      threadId: input.externalSessionId,
      excludeTurns: true,
    });
    if (
      response.thread.id !== input.externalSessionId ||
      !(await this.options.directoriesMatch(response.cwd, input.workingDirectory))
    )
      throw new Error("Codex resumed a different conversation or directory.");
    const session = sessionStateFromExistingThread(input, runtimeId, undefined, response);
    session.preserveNativeSettings = true;
    session.summary = { ...session.summary, title: metadata.title ?? input.externalSessionId };
    return { client, metadata, response, session };
  }

  async updateSessionModel(
    input: UpdateAgentSessionModelInput,
    binding?: PolicyBoundSessionRef,
  ): Promise<void> {
    if (!this.localSessions.get(input.externalSessionId) && binding) {
      const guardedBinding = {
        ...binding,
        workStartGuard: input.workStartGuard,
        onWorkIssued: input.onWorkIssued,
      };
      const handle = await this.openExistingSession(guardedBinding);
      await handle.attach();
    }
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) throw new Error(`Unknown Codex session '${input.externalSessionId}'.`);
    if (input.model) {
      const client = this.runtimeClients.clientForRuntime(session.runtimeId);
      await this.models.validate(client, session.runtimeId, input.model);
    }
    assertAgentWorkStartCurrent(input);
    if (this.localSessions.get(input.externalSessionId) !== session)
      throw new Error(
        "The Codex session closed while its settings were checked. Reopen the chat and retry.",
      );
    if (input.model) session.model = input.model;
    else delete session.model;
    markAgentWorkAccepted(input);
  }

  async updateSessionTitle(
    input: AgentSessionControlUpdateTitleInput,
  ): Promise<AgentSessionTitleUpdateResult> {
    const session = this.localSessions.get(input.externalSessionId);
    if (!session) {
      return { status: "not_attached" };
    }
    assertCodexSessionRef(session, input, "update the title of");
    const { client } = await this.runtimeClients.resolve(input, "update session title");
    if (this.freshTitleState.has(session)) this.freshTitleState.set(session, "tried");
    await client.threadSetName({
      threadId: session.threadId,
      name: input.title,
    });
    this.freshTitleState.delete(session);
    session.nativeName = input.title;
    session.summary = withSummaryTitle(session.summary, input.title);
    return { status: "renamed", summary: session.summary };
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
      input,
      "ensure Codex session state",
      this.options.resolveWorkflowRolePolicy,
    );
    const policy = sessionPolicy.runtimePolicy;
    const config = await this.threadConfig(input.repoPath, sessionPolicy);
    const threadResumeInput: CodexAppServerThreadResumeParams =
      sessionPolicy.kind === "repository"
        ? { config, threadId: input.externalSessionId, excludeTurns: true }
        : {
            ...codexTransportPolicy(policy),
            config,
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
    assertAgentWorkStartCurrent(input);
    markAgentWorkIssued(input);
    const response = await client.threadResume(threadResumeInput);
    const session = sessionStateFromExistingThread(input, runtimeId, model, response);
    if (sessionPolicy.kind === "repository") {
      session.preserveNativeSettings = true;
      await this.applyRepositoryTitle(input, session, sessionPolicy.title, {
        tolerateFailure: true,
      });
    }
    const { summary } = session;
    const existingThreadSession = preserveRuntimeContextForExistingThread(
      session,
      this.localSessions.get(summary.externalSessionId),
    );
    this.localSessions.remember(existingThreadSession);
    return summary;
  }

  private async readFirstTurnCompleted(
    client: CodexAppServerClient,
    response: CodexThreadResumeResult,
    threadId: string,
  ): Promise<boolean> {
    if (response.thread.historyMode === "paginated" && response.turnsBackwardsCursor === undefined)
      throw new Error("Codex did not report turn history. Reattach this chat to retry.");
    if (response.thread.historyMode !== "legacy" && response.turnsBackwardsCursor === null)
      return false;
    const firstTurn = await client.threadTurnsList({
      threadId,
      cursor: null,
      limit: 1,
      sortDirection: "asc",
      itemsView: "notLoaded",
    });
    if (!firstTurn.data[0] && response.turnsBackwardsCursor)
      throw new Error("Codex did not return the first turn. Reattach this chat to retry.");
    return firstTurn.data[0] !== undefined && firstTurn.data[0].status !== "inProgress";
  }

  private async applyRepositoryTitle(
    input: PolicyBoundSessionRef,
    session: CodexSessionState,
    repositoryTitle: string | undefined,
    options: { tolerateFailure?: boolean } = {},
  ): Promise<void> {
    if (repositoryTitle === undefined) return;
    const state = this.freshTitleState.get(session);
    if (state === "pending") return;
    if (session.nativeName === repositoryTitle) return;
    const { client } = await this.runtimeClients.resolve(
      input,
      "apply the repository session title",
    );
    try {
      await client.threadSetName({
        threadId: session.threadId,
        name: repositoryTitle,
      });
    } catch (cause) {
      // Codex may write the name before this call fails. A later attach checks it.
      // Session replacement must still fail.
      if (options.tolerateFailure !== true) throw cause;
      return;
    }
    this.freshTitleState.delete(session);
    session.nativeName = repositoryTitle;
    session.summary = withSummaryTitle(session.summary, repositoryTitle);
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
      this.generatedImages.releaseSession(input);
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

  resolvePendingApproval(
    input: import("@openducktor/contracts").AgentSessionLiveRef & {
      runtimeId: string;
      requestId: string;
    },
  ) {
    const sessions = this.listLiveSessionSnapshots(input.runtimeId);
    const caller = sessions.find(
      (value) => value.ref.externalSessionId === input.externalSessionId,
    );
    if (
      !caller ||
      caller.ref.repoPath !== input.repoPath ||
      caller.ref.workingDirectory !== input.workingDirectory ||
      input.runtimeKind !== "codex"
    )
      throw new Error("The approval caller does not match its registered runtime session.");
    const pending = this.pendingInput.requireApprovalForSession(
      input.requestId,
      input.externalSessionId,
      input.runtimeId,
    );
    const owner = sessions.find((value) => value.ref.externalSessionId === pending.threadId);
    if (
      !owner ||
      owner.ref.repoPath !== input.repoPath ||
      owner.ref.workingDirectory !== input.workingDirectory
    )
      throw new Error("The approval owner is not registered in this workspace.");
    let root = owner;
    const seen = new Set<string>();
    while (!this.localSessions.get(root.ref.externalSessionId)) {
      if (seen.has(root.ref.externalSessionId))
        throw new Error("The approval ancestry contains a cycle.");
      seen.add(root.ref.externalSessionId);
      const route = this.subagents.routeForChild(root.ref.externalSessionId, input.runtimeId);
      const parent =
        route &&
        sessions.find((value) => value.ref.externalSessionId === route.parentExternalSessionId);
      if (
        !parent ||
        parent.ref.repoPath !== input.repoPath ||
        parent.ref.workingDirectory !== input.workingDirectory
      )
        throw new Error("The approval parent chain is not registered in this workspace.");
      root = parent;
    }
    return { owner: owner.ref, root: root.ref, request: pending.request };
  }

  async replyLiveApproval(input: CodexLiveApprovalReplyInput): Promise<void> {
    requireCodexPendingRequestKey(input.requestId, "approval");
    const pending = this.pendingInput.claimApprovalForSession(
      input.requestId,
      input.externalSessionId,
      input.runtimeId,
    );
    const nativeRequest = pending.nativeRequest;
    let issued = false;
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
        () => {
          issued = true;
          input.onIssued?.();
        },
      );
    } catch (error) {
      if (!issued) this.pendingInput.releaseApprovalReplyClaim(input.requestId, pending.runtimeId);
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

  async replyQuestion(input: ReplyQuestionInput): Promise<AgentEvent> {
    assertCodexRuntimePolicyBinding(input, "reply to Codex question");
    const mustRestoreQuestions = !this.localSessions.has(input.externalSessionId);
    const session = this.policyBoundSession(
      input,
      { lookup: "reply to question for", context: "reply to question" },
      true,
    );
    const reply = async (boundSession: CodexSessionState): Promise<AgentEvent> => {
      if (mustRestoreQuestions) {
        await this.loadSessionHistory(input);
      }
      return this.replyLiveQuestion({
        runtimeId: boundSession.runtimeId,
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
        answers: input.answers,
      });
    };
    return session instanceof Promise ? session.then(reply) : reply(session);
  }

  async replyLiveQuestion(input: CodexLiveQuestionReplyInput): Promise<AgentEvent> {
    const backgroundReplies = this.asyncQuestions.claimRepliesForSession(
      input.runtimeId,
      input.externalSessionId,
      input.requestId,
      input.answers,
    );
    if (backgroundReplies) {
      const session = this.localSessions.get(input.externalSessionId);
      if (!session || session.runtimeId !== input.runtimeId) {
        this.asyncQuestions.releaseReplyClaim(
          input.runtimeId,
          input.externalSessionId,
          input.requestId,
        );
        throw new Error(
          `Cannot answer Codex question '${input.requestId}' because its session is not loaded. Reload the session and try again.`,
        );
      }
      const text = codexAsyncQuestionReplyText(backgroundReplies);
      const parts = [{ kind: "text" as const, text }];
      const acceptedUserMessage = createCodexAcceptedUserMessage({
        session,
        parts,
        model: session.model ?? undefined,
        resolvedQuestionRequestIds: [input.requestId],
      });
      const nativeInput = [toCodexAsyncQuestionReplyInput(backgroundReplies)];
      let accepted: AcceptedAgentUserMessage;
      try {
        accepted = await sendCodexQuestionReply(
          this.turnLifecycleContext(),
          input.externalSessionId,
          nativeInput,
          acceptedUserMessage,
        );
      } catch (error) {
        this.asyncQuestions.releaseReplyClaim(
          input.runtimeId,
          input.externalSessionId,
          input.requestId,
        );
        throw error;
      }
      // The caller publishes this accepted reply, and the native echo is suppressed.
      session.firstTurnHistory?.record(accepted, session.model);
      const replyTools = codexAsyncQuestionReplyTools(backgroundReplies);
      const resolvedRequestIds = replyTools.map(({ requestId }) => requestId);
      this.asyncQuestions.resolve(input.runtimeId, input.externalSessionId, resolvedRequestIds);
      const timestamp = new Date().toISOString();
      const completionEvents: AgentEvent[] = [];
      for (const { requestId, invocation } of replyTools) {
        completionEvents.push({
          type: "question_resolved",
          requestId,
          externalSessionId: input.externalSessionId,
          timestamp,
        });
        const toolEvent: AgentEvent = {
          type: "assistant_part",
          externalSessionId: input.externalSessionId,
          timestamp,
          part: requireNormalizedCodexToolInvocation(invocation),
        };
        completionEvents.push(toolEvent);
      }
      for (const event of completionEvents) {
        this.emitSessionEvent(input.externalSessionId, event);
      }
      const publishLiveSessionMutation = this.options.onLiveSessionMutation;
      if (publishLiveSessionMutation) {
        const sessionRef = codexSessionRef(session);
        try {
          await publishLiveSessionMutation({
            runtimeId: input.runtimeId,
            snapshotMode: "delta",
            removedRefs: [],
            snapshots: this.changedLiveSessionSnapshots(
              input.runtimeId,
              new Set([input.externalSessionId]),
            ),
            transcriptEvents: completionEvents
              .filter((event) => isAgentSessionTranscriptEventType(event.type))
              .map((event) => withAgentSessionRef(sessionRef, event)),
            catalogInvalidated: false,
          });
        } catch (cause) {
          throw new CodexMessageAcceptedError(accepted, cause);
        }
      }
      return accepted;
    }
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
      const timestamp = new Date().toISOString();
      const part = requireNormalizedCodexToolInvocation({
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
      });
      completedQuestionEvent = {
        type: "assistant_part",
        externalSessionId: input.externalSessionId,
        timestamp,
        part,
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
    this.questionHistory.add(pending.runtimeId, input.externalSessionId, {
      messageId: completedQuestionEvent.part.messageId,
      role: "assistant",
      timestamp: completedQuestionEvent.timestamp,
      text: "",
      parts: [completedQuestionEvent.part],
    });
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
    const pendingQuestions = [
      ...this.pendingInput.pendingQuestionsForSession(session.threadId, session.runtimeId),
      ...this.asyncQuestions.pendingForSession(session.runtimeId, session.threadId),
    ].map(toLivePendingQuestion);
    const runtimeActivity =
      session.liveStatus?.classification ??
      (session.summary.status === "running" || session.summary.status === "starting"
        ? "running"
        : "idle");
    const route = this.subagents.routeForChild(session.threadId, session.runtimeId);
    const snapshot: AgentSessionLiveSnapshot = {
      ref: codexSessionRef(session),
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
    if (session.summary.sessionAssociation.kind === "repository") {
      snapshot.repositoryScope = session.summary.sessionAssociation;
    }
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
    const pendingQuestions = [
      ...this.pendingInput.pendingQuestionsForSession(
        route.childExternalSessionId,
        parentSession.runtimeId,
      ),
      ...this.asyncQuestions.pendingForSession(
        parentSession.runtimeId,
        route.childExternalSessionId,
      ),
    ].map(toLivePendingQuestion);
    const contextUsage = this.runtimeEvents.latestContextUsage(
      parentSession.runtimeId,
      route.childExternalSessionId,
    );
    const childStatus = this.subagents.statusForChild(
      route.childExternalSessionId,
      parentSession.runtimeId,
    );
    const isRunning = childStatus === "pending" || childStatus === "running";
    const snapshot: AgentSessionLiveSnapshot = {
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
    };
    if (parentSession.summary.sessionAssociation.kind === "repository") {
      snapshot.repositoryScope = parentSession.summary.sessionAssociation;
    }
    return agentSessionLiveSnapshotSchema.parse(snapshot);
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
    const thread = inventory.threadsById.get(input.externalSessionId);
    if (thread && !(await this.options.directoriesMatch(thread.cwd, input.workingDirectory))) {
      return runtimeId;
    }
    this.recordInventorySubagentRoutes(inventory, runtimeId, thread?.cwd ?? input.workingDirectory);
    if (!thread) {
      if (this.subagents.routeForChild(input.externalSessionId, runtimeId)) {
        await this.ensureSessionState(input);
        this.clearThreadInventory(runtimeId);
      }
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
    this.settleGeneratedImages(session.runtimeId, codexSessionRef(session));
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
    this.generatedImages.releaseSession({ ...codexSessionRef(session), runtimeKind: "codex" });
    this.asyncQuestions.clearSession(session.runtimeId, session.threadId);
    for (const route of descendants.toReversed()) {
      this.generatedImages.releaseSession({
        ...codexSessionRef(session),
        runtimeKind: "codex",
        externalSessionId: route.childExternalSessionId,
      });
      this.contextUsageLoader.cancelSession({
        ...codexSessionRef(session),
        externalSessionId: route.childExternalSessionId,
      });
      this.asyncQuestions.clearSession(session.runtimeId, route.childExternalSessionId);
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
      asyncQuestions: this.asyncQuestions,
      directoriesMatch: this.options.directoriesMatch,
      hasActiveTurn: (externalSessionId: string) =>
        runningTurnOf(this.activeTurnsBySessionId, externalSessionId) !== null,
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
    this.sessionEvents.publish(session, event);
  }

  private turnLifecycleContext(): CodexTurnLifecycleContext {
    const context: CodexTurnLifecycleContext = {
      sessions: this.localSessions,
      activeTurnsBySessionId: this.activeTurnsBySessionId,
      clientForRuntime: (runtimeId) => this.runtimeClients.clientForRuntime(runtimeId),
      ensureRuntimeEventSubscription: (runtimeId) =>
        this.runtimeEvents.ensureRuntimeEventSubscription(runtimeId),
      bindActiveTurnId: (activeTurn, turnId, startedAtMs) =>
        this.runtimeEvents.bindActiveTurnId(activeTurn, turnId, startedAtMs),
      bindPendingInputToActiveTurn: (externalSessionId, activeTurn) =>
        this.runtimeEvents.bindPendingInputToActiveTurn(externalSessionId, activeTurn),
      setSessionLiveStatus: (session, liveStatus) =>
        this.runtimeEvents.setSessionLiveStatus(session, liveStatus),
      expectUserMessageEcho: (event, sourceParts) =>
        this.runtimeEvents.expectUserMessageEcho(event, sourceParts),
      emitUserMessage: (event) => this.runtimeEvents.emitUserMessage(event),
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
    const { client, runtimeId } = await this.runtimeClients.resolve(
      input,
      "load Codex session diff",
    );
    const session = this.querySession(input, runtimeId);
    if (!session) {
      await this.readScopedThread(client, input);
    }
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
