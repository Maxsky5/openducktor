import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type RuntimeKind,
  hasRuntimeType,
} from "@openducktor/contracts";
import { asUnknownRecord } from "./guards";
import type {
  AcceptedAgentUserMessage,
  AgentCatalogPort,
  AgentEvent,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionRuntimePolicy,
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
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
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  agentSessionRefsEqual,
  assertAgentRuntimePolicyBinding,
  classifySystemSlashCommandInvocation,
  toAgentSessionRuntimeSnapshot,
  withAgentSessionRef,
} from "@openducktor/core";
import {
  listAvailableModels,
  listAvailableSlashCommands,
  listAvailableSubagents,
  searchFiles,
} from "./catalog-and-mcp";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { unwrapData } from "./data-utils";
import {
  loadFileStatus as loadFileStatusOp,
  loadSessionDiff as loadSessionDiffOp,
} from "./diff-ops";
import {
  clearSessionListeners,
  emitSessionEvent,
  type SessionEventListeners,
  subscribeSessionEvents,
} from "./event-emitter";
import {
  applyOpencodeAwaitingTurnStartToRuntimeSnapshot,
  findOpencodeLocalRuntimeSnapshot,
  listOpencodeLocalRuntimeSnapshots,
  listOpencodeRuntimeSnapshotSources,
} from "./live-session-snapshots";
import { sendUserMessage, usesPromptAsyncTransport } from "./message-execution";
import { loadSessionHistory, loadSessionTodos } from "./message-ops";
import { createOpenCodeMessageId } from "./opencode-message-id";
import {
  adoptPreparedOpencodeSessionPolicy,
  applyRuntimeContextToSession,
  applySessionPolicy,
  requireOpencodeSessionPolicyRuntime,
  resolveOpencodePolicyBoundSession,
  synchronizeOpencodeSessionPolicy,
} from "./opencode-session-binding";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import {
  beginOpencodeUserMessageSend,
  completeOpencodeUserMessageSend,
  failOpencodeUserMessageSend,
  projectAdmittedOpencodeUserMessage,
} from "./opencode-agent-session-projection";
import { opencodeSessionDetailPayloadSchema } from "./opencode-ingress";
import { replyApproval, replyQuestion } from "./pending-input-ops";
import { toOpenCodeRequestError } from "./request-errors";
import {
  type OpencodeRuntimeResolutionInput,
  resolveOpencodeRuntimeClientInput,
} from "./runtime-connection";
import { opencodeSessionRef } from "./session-ref";
import {
  registerSession,
  releaseSessionRuntime,
  requireSession,
  stopSessionRuntime,
  subscribeSessionToRuntimeEvents,
} from "./session-registry";
import { toIsoFromEpoch, toSessionInput } from "./session-runtime-utils";
import type {
  ClientFactory,
  OpencodeEventLogger,
  OpencodeSdkAdapterOptions,
  RepoRuntimeResolverPort,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";
import { WORKFLOW_TOOL_CACHE_TTL_MS } from "./types";
import { waitForUserMessageAdmission } from "./user-message-admission";
import {
  ensureTrustedOdtMcpServerConnected,
  resolveRepositoryToolSelection,
  resolveWorkflowToolSelection,
} from "./workflow-tool-selection";

const toExistingSessionInput = (input: PolicyBoundSessionRef): SessionInput => {
  return toSessionInput(input);
};

const assertOpenCodeRuntimePolicyBinding = (
  input: { runtimeKind: RuntimeKind; runtimePolicy: AgentSessionRuntimePolicy },
  action: string,
): void => {
  assertAgentRuntimePolicyBinding(input, action);
  if (input.runtimeKind !== "opencode") {
    throw new Error(`Cannot ${action} for non-OpenCode runtime '${input.runtimeKind}'.`);
  }
};

export class OpencodeSdkAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly sessions: Map<string, SessionRecord>;
  private readonly runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  private readonly listeners: SessionEventListeners = new Map();
  private readonly now: () => string;
  private readonly createClient: ClientFactory;
  private readonly repoRuntimeResolver: RepoRuntimeResolverPort | undefined;
  private readonly logEvent: OpencodeEventLogger | undefined;

  constructor(
    options: OpencodeSdkAdapterOptions = {},
    runtimeState?: {
      sessions: Map<string, SessionRecord>;
      runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
    },
  ) {
    this.sessions = runtimeState?.sessions ?? new Map();
    this.runtimeEventTransports = runtimeState?.runtimeEventTransports ?? new Map();
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.repoRuntimeResolver = options.repoRuntimeResolver;
    this.logEvent = options.logEvent;
  }

  private async resolveRuntimeClientInput(input: OpencodeRuntimeResolutionInput, action: string) {
    return resolveOpencodeRuntimeClientInput({
      repoRuntimeResolver: this.repoRuntimeResolver,
      input,
      action,
    });
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "start OpenCode session");
    const runtimeDefinition = this.getRuntimeDefinition();
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      runtimeDefinition,
      "start OpenCode session",
    );
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "start session");
    const client = this.createClient(runtimeClientInput);
    await requireOpencodeSessionPolicyRuntime({
      client,
      policy,
      workingDirectory: input.workingDirectory,
    });
    const created = await client.session.create({
      directory: input.workingDirectory,
      title: policy.title,
      permission: policy.permission,
    });
    const createdData = unwrapData(created, "create session");
    const externalSessionId = createdData.id;
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Started ${policy.activityLabel} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : undefined),
    });
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "resume OpenCode session");
    const runtimeDefinition = this.getRuntimeDefinition();
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      runtimeDefinition,
      "resume OpenCode session",
    );
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      const registeredSessionRef = opencodeSessionRef(existing);
      if (!agentSessionRefsEqual(registeredSessionRef, input)) {
        throw new Error(
          `Cannot resume OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
        );
      }
      await synchronizeOpencodeSessionPolicy({
        action: "resume session",
        policy,
        request: input,
        session: existing,
      });
      return existing.summary;
    }

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "resume session");
    const client = this.createClient(runtimeClientInput);
    await requireOpencodeSessionPolicyRuntime({
      client,
      policy,
      workingDirectory: input.workingDirectory,
    });
    const detail = await client.session.get({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
    });
    const detailData = unwrapData(detail, "get session");
    await applySessionPolicy({
      client,
      externalSessionId: input.externalSessionId,
      policy,
      workingDirectory: input.workingDirectory,
    });
    const detailRecord = opencodeSessionDetailPayloadSchema.parse(detailData);
    const startedAt = toIsoFromEpoch(asUnknownRecord(detailRecord?.time)?.created, this.now);
    const sessionInput = toSessionInput(input);
    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      startedMessage: `Resumed ${policy.activityLabel} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : undefined),
    });
  }

  private async ensureSessionState(input: PolicyBoundSessionRef): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "ensure OpenCode session state");
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      const registeredSessionRef = opencodeSessionRef(existing);
      if (!agentSessionRefsEqual(registeredSessionRef, input)) {
        throw new Error(
          `Cannot ensure OpenCode session state for '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
        );
      }
      if (input.sessionScope) {
        await synchronizeOpencodeSessionPolicy({
          action: "ensure session state",
          policy: resolveOpencodeSessionPolicy(
            input.sessionScope,
            this.getRuntimeDefinition(),
            "ensure OpenCode session state",
          ),
          request: input,
          session: existing,
        });
      } else {
        applyRuntimeContextToSession(existing, input, "ensure session state");
      }
      return existing.summary;
    }

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "ensure session state");
    const client = this.createClient(runtimeClientInput);
    const policy = input.sessionScope
      ? resolveOpencodeSessionPolicy(
          input.sessionScope,
          this.getRuntimeDefinition(),
          "ensure OpenCode session state",
        )
      : null;
    if (policy) {
      await requireOpencodeSessionPolicyRuntime({
        client,
        policy,
        workingDirectory: input.workingDirectory,
      });
    }
    const detail = await client.session.get({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
    });
    const detailData = unwrapData(detail, "get session");
    if (policy) {
      await applySessionPolicy({
        client,
        externalSessionId: input.externalSessionId,
        policy,
        workingDirectory: input.workingDirectory,
      });
    }
    const detailRecord = opencodeSessionDetailPayloadSchema.parse(detailData);
    const startedAt = toIsoFromEpoch(asUnknownRecord(detailRecord?.time)?.created, this.now);
    const sessionInput = toExistingSessionInput(input);

    const summary = registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      emitStartedEvent: false,
      subscribeToEvents: false,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : undefined),
    });

    try {
      subscribeSessionToRuntimeEvents({
        sessions: this.sessions,
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeId: runtimeClientInput.runtimeId,
        runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput,
        now: this.now,
        emit: this.emit.bind(this),
        ...(this.logEvent ? { logEvent: this.logEvent } : undefined),
      });
    } catch (error) {
      const session = this.sessions.get(input.externalSessionId);
      if (session) {
        await releaseSessionRuntime(session, this.sessions, this.runtimeEventTransports);
      }
      throw error;
    }

    return summary;
  }

  private policyBoundSessionState(
    input: PolicyBoundSessionRef,
    action: string,
  ): SessionRecord | Promise<SessionRecord> {
    return resolveOpencodePolicyBoundSession({
      request: input,
      action,
      retainedSession: this.sessions.get(input.externalSessionId),
      bindSession: async () => {
        await this.ensureSessionState(input);
        return requireSession(this.sessions, input.externalSessionId);
      },
    });
  }

  async releaseSession(input: SessionRef): Promise<void> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      clearSessionListeners(this.listeners, input);
      return;
    }
    const sessionRef = opencodeSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot release OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    await releaseSessionRuntime(session, this.sessions, this.runtimeEventTransports);
    clearSessionListeners(this.listeners, sessionRef);
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "fork OpenCode session");
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      this.getRuntimeDefinition(),
      "fork OpenCode session",
    );
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "fork session");
    const client = this.createClient(runtimeClientInput);
    await requireOpencodeSessionPolicyRuntime({
      client,
      policy,
      workingDirectory: input.workingDirectory,
    });
    const forked = await client.session.fork({
      directory: input.workingDirectory,
      sessionID: input.parentExternalSessionId,
      ...(input.runtimeHistoryAnchor ? { messageID: input.runtimeHistoryAnchor } : undefined),
    });
    const forkedData = unwrapData(forked, "fork session");
    const externalSessionId = forkedData.id;
    try {
      await applySessionPolicy({
        client,
        externalSessionId,
        policy,
        workingDirectory: input.workingDirectory,
      });
    } catch (policyError) {
      try {
        const deleted = await client.session.delete({
          directory: input.workingDirectory,
          sessionID: externalSessionId,
        });
        if (deleted.data !== true) {
          throw toOpenCodeRequestError(
            `delete unregistered fork '${externalSessionId}'`,
            deleted.error,
            deleted.response,
          );
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [policyError, cleanupError],
          `Failed to apply ${policy.toolSelection.kind} policy to forked OpenCode session '${externalSessionId}' and delete the unregistered fork.`,
        );
      }
      throw policyError;
    }
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Forked ${policy.activityLabel} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : undefined),
    });
  }

  async listSessionRuntimeSnapshots(
    input: ListSessionRuntimeSnapshotsInput,
  ): Promise<AgentSessionRuntimeSnapshot[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      { ...input, workingDirectory: input.repoPath },
      "list session runtime snapshots",
    );
    const snapshots = await listOpencodeRuntimeSnapshotSources({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      now: this.now,
      ...(input.directories ? { directories: input.directories } : undefined),
    });
    const existingExternalSessionIds = new Set(
      snapshots.map((snapshot) => snapshot.externalSessionId),
    );
    const localSnapshots = listOpencodeLocalRuntimeSnapshots({
      sessions: this.sessions,
      runtimeId: runtimeClientInput.runtimeId,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      ...(input.directories ? { directories: input.directories } : undefined),
      existingExternalSessionIds,
    });
    const liveSnapshots = snapshots.map((snapshot) =>
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: snapshot.workingDirectory,
          externalSessionId: snapshot.externalSessionId,
        },
        snapshot: applyOpencodeAwaitingTurnStartToRuntimeSnapshot({
          sessions: this.sessions,
          runtimeId: runtimeClientInput.runtimeId,
          snapshot,
        }),
      }),
    );
    const localRuntimeSnapshots = localSnapshots.map((snapshot) =>
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: snapshot.workingDirectory,
          externalSessionId: snapshot.externalSessionId,
        },
        snapshot,
      }),
    );
    return [...liveSnapshots, ...localRuntimeSnapshots];
  }

  async readSessionRuntimeSnapshot(
    input: ReadSessionRuntimeSnapshotInput,
  ): Promise<AgentSessionRuntimeSnapshot> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      input,
      "read session runtime snapshot",
    );
    const snapshots = await listOpencodeRuntimeSnapshotSources({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      directories: [input.workingDirectory],
      now: this.now,
    });
    const scannedSnapshot =
      snapshots.find((candidate) => candidate.externalSessionId === input.externalSessionId) ??
      null;
    const localSnapshot = findOpencodeLocalRuntimeSnapshot({
      sessions: this.sessions,
      runtimeId: runtimeClientInput.runtimeId,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      externalSessionId: input.externalSessionId,
    });
    const snapshot = scannedSnapshot
      ? applyOpencodeAwaitingTurnStartToRuntimeSnapshot({
          sessions: this.sessions,
          runtimeId: runtimeClientInput.runtimeId,
          snapshot: scannedSnapshot,
        })
      : localSnapshot;
    if (!snapshot) {
      return toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot: null,
      });
    }

    const canonicalWorkingDirectory =
      scannedSnapshot?.workingDirectory ??
      localSnapshot?.workingDirectory ??
      input.workingDirectory;
    return toAgentSessionRuntimeSnapshot({
      ref: {
        ...input,
        workingDirectory: canonicalWorkingDirectory,
      },
      snapshot,
    });
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    assertOpenCodeRuntimePolicyBinding(input, "load OpenCode session history");
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "load session history");
    const matchingSessions = [...this.sessions.values()].filter(
      (session) =>
        session.externalSessionId === input.externalSessionId &&
        session.runtimeId === runtimeClientInput.runtimeId,
    );
    for (const session of matchingSessions) {
      const registeredSessionRef = opencodeSessionRef(session);
      if (!agentSessionRefsEqual(registeredSessionRef, input)) {
        throw new Error(
          `Cannot load OpenCode session history for '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
        );
      }
    }
    if (input.sessionScope) {
      const policy = resolveOpencodeSessionPolicy(
        input.sessionScope,
        this.getRuntimeDefinition(),
        "load OpenCode session history",
      );
      await requireOpencodeSessionPolicyRuntime({
        client: this.createClient(runtimeClientInput),
        policy,
        workingDirectory: input.workingDirectory,
      });
      for (const session of matchingSessions) {
        await adoptPreparedOpencodeSessionPolicy({
          action: "load session history",
          policy,
          request: input,
          session,
        });
      }
    } else {
      for (const session of matchingSessions) {
        applyRuntimeContextToSession(session, input, "load session history");
      }
    }
    const preservedDisplayPartsByMessageId = new Map(
      matchingSessions.flatMap((session) =>
        [...session.messageMetadataById.entries()].flatMap(([messageId, metadata]) =>
          metadata.displayParts ? [[messageId, metadata.displayParts] as const] : [],
        ),
      ),
    );

    const historyInput = {
      ...runtimeClientInput,
      externalSessionId: input.externalSessionId,
      ...(hasRuntimeType(input.limit, "number") ? { limit: input.limit } : undefined),
      ...(preservedDisplayPartsByMessageId.size > 0
        ? { preservedDisplayPartsByMessageId }
        : undefined),
    };

    return loadSessionHistory(this.createClient, this.now, historyInput);
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    assertOpenCodeRuntimePolicyBinding(input, "load OpenCode session todos");
    if (this.sessions.has(input.externalSessionId)) {
      await this.policyBoundSessionState(input, "load todos for");
    }
    return loadSessionTodos(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "load session todos")),
      externalSessionId: input.externalSessionId,
    });
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    return listAvailableModels(
      this.createClient,
      await this.resolveRuntimeClientInput(
        { ...input, workingDirectory: input.repoPath },
        "list available models",
      ),
    );
  }

  async listAvailableSlashCommands(
    input: import("@openducktor/core").ListAgentSlashCommandsInput,
  ): Promise<import("@openducktor/core").AgentSlashCommandCatalog> {
    return listAvailableSlashCommands(
      this.createClient,
      await this.resolveRuntimeClientInput(input, "list available slash commands"),
    );
  }

  async listAvailableSkills(
    _: import("@openducktor/core").ListAgentSkillsInput,
  ): Promise<import("@openducktor/core").AgentSkillCatalog> {
    throw new Error("OpenCode does not support skill reference catalogs.");
  }

  async listAvailableSubagents(
    input: import("@openducktor/core").ListAgentSubagentsInput,
  ): Promise<import("@openducktor/core").AgentSubagentCatalog> {
    return listAvailableSubagents(
      this.createClient,
      await this.resolveRuntimeClientInput(input, "list available subagents"),
    );
  }

  async searchFiles(
    input: import("@openducktor/core").SearchAgentFilesInput,
  ): Promise<import("@openducktor/core").AgentFileSearchResult[]> {
    return searchFiles(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "search files")),
      query: input.query,
    });
  }

  shouldRestartRuntimeForMcpStatusError(message: string): boolean {
    return /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage> {
    assertOpenCodeRuntimePolicyBinding(input, "send OpenCode user message");
    resolveOpencodeSessionPolicy(
      input.sessionScope,
      this.getRuntimeDefinition(),
      "send OpenCode user message",
    );
    let systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>;
    try {
      systemInvocation = classifySystemSlashCommandInvocation(input.parts);
    } catch (error) {
      throw toOpenCodeRequestError("compact session", error);
    }
    const session = this.policyBoundSessionState(input, "send");
    return session instanceof Promise
      ? session.then((boundSession) =>
          this.sendUserMessageFromBoundSession(input, boundSession, systemInvocation),
        )
      : this.sendUserMessageFromBoundSession(input, session, systemInvocation);
  }

  private async sendUserMessageFromBoundSession(
    input: SendAgentUserMessageInput,
    session: SessionRecord,
    systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>,
  ): Promise<AcceptedAgentUserMessage> {
    const expectsPromptTurnStart = usesPromptAsyncTransport(input.parts);
    const waitsForRuntimeAdmission =
      systemInvocation.kind === "not_system" && !expectsPromptTurnStart;
    const messageId = waitsForRuntimeAdmission ? createOpenCodeMessageId() : undefined;
    const admission = messageId ? waitForUserMessageAdmission(session, messageId) : undefined;
    const begunSend = beginOpencodeUserMessageSend({
      session,
      expectsPromptTurnStart,
      isManualSessionCompaction: systemInvocation.kind === "manual_session_compaction",
      timestamp: this.now(),
    });
    this.emit(input.externalSessionId, begunSend.runningEvent);
    try {
      const tools =
        systemInvocation.kind === "manual_session_compaction"
          ? {}
          : await this.resolveSessionToolSelection(session);
      const admittedUserMessage = await sendUserMessage({
        session,
        request: input,
        tools,
        ...(messageId ? { messageId } : undefined),
        ...(admission ? { admission: admission.promise } : undefined),
      });
      const timestamp = this.now();
      const event: AcceptedAgentUserMessage = {
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp,
        ...admittedUserMessage,
      };
      if (systemInvocation.kind !== "manual_session_compaction") {
        projectAdmittedOpencodeUserMessage({
          externalSessionId: session.externalSessionId,
          input: session.input,
          session,
          now: this.now,
          emit: this.emit.bind(this),
          message: {
            ...admittedUserMessage,
            timestamp,
          },
        });
      }
      return event;
    } catch (error) {
      const idleEvent = failOpencodeUserMessageSend(
        session,
        begunSend.preserveActiveTurnOnFailure,
        this.now(),
      );
      if (idleEvent && this.sessions.get(input.externalSessionId) === session) {
        this.emit(input.externalSessionId, idleEvent);
      }
      throw error;
    } finally {
      admission?.dispose();
      completeOpencodeUserMessageSend(session);
    }
  }

  async updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    session.input = {
      ...session.input,
      ...(input.model ? { model: input.model } : undefined),
    };
    if (!input.model) {
      delete session.input.model;
    }
    delete session.workflowToolSelectionCache;
    delete session.workflowToolSelectionCachedAt;
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    assertOpenCodeRuntimePolicyBinding(input, "reply to OpenCode approval");
    const reply = async (session: SessionRecord) => {
      await replyApproval(session, input);
      this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
    };
    const session = this.policyBoundSessionState(input, "reply to approval for");
    return session instanceof Promise ? session.then(reply) : reply(session);
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    assertOpenCodeRuntimePolicyBinding(input, "reply to OpenCode question");
    const reply = async (session: SessionRecord) => {
      await replyQuestion(session, input);
      this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
    };
    const session = this.policyBoundSessionState(input, "reply to question for");
    return session instanceof Promise ? session.then(reply) : reply(session);
  }

  async subscribeEvents(
    input: PolicyBoundSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe> {
    assertOpenCodeRuntimePolicyBinding(input, "subscribe OpenCode session events");
    const subscribe = (session: SessionRecord) =>
      subscribeSessionEvents(this.listeners, opencodeSessionRef(session), listener);
    const session = this.policyBoundSessionState(input, "subscribe to events for");
    return session instanceof Promise ? session.then(subscribe) : subscribe(session);
  }

  async stopSession(input: SessionRef): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    const sessionRef = opencodeSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot stop OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    await stopSessionRuntime(session, this.sessions, this.runtimeEventTransports);

    emitSessionEvent(
      this.listeners,
      sessionRef,
      withAgentSessionRef(sessionRef, {
        type: "session_finished",
        externalSessionId: input.externalSessionId,
        timestamp: this.now(),
        message: "Session stopped",
      }),
    );
    clearSessionListeners(this.listeners, sessionRef);
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    return loadSessionDiffOp(
      (await this.resolveRuntimeClientInput(input, "load session diff")).runtimeEndpoint,
      input.externalSessionId,
      input.runtimeHistoryAnchor,
    );
  }

  async loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return loadFileStatusOp(
      (await this.resolveRuntimeClientInput(input, "load file status")).runtimeEndpoint,
    );
  }

  private emit(externalSessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      if (event.sessionRef) {
        emitSessionEvent(this.listeners, event.sessionRef, event);
        return;
      }
      throw new Error(
        `Cannot emit OpenCode session event for missing session '${externalSessionId}'.`,
      );
    }
    const sessionRef = opencodeSessionRef(session);
    emitSessionEvent(this.listeners, sessionRef, withAgentSessionRef(sessionRef, event));
  }

  private clearPendingSubagentInputEvent(externalSessionId: string, requestId: string): void {
    for (const session of this.sessions.values()) {
      const pending = session.pendingSubagentInputEventsByExternalSessionId.get(externalSessionId);
      if (!pending) {
        continue;
      }

      const nextPending = pending.filter((event) => event.requestId !== requestId);
      if (nextPending.length === pending.length) {
        continue;
      }
      if (nextPending.length === 0) {
        session.pendingSubagentInputEventsByExternalSessionId.delete(externalSessionId);
        continue;
      }
      session.pendingSubagentInputEventsByExternalSessionId.set(externalSessionId, nextPending);
    }
  }

  private async resolveSessionToolSelection(
    session: SessionRecord,
  ): Promise<Record<string, boolean>> {
    const policy = resolveOpencodeSessionPolicy(
      session.input.sessionScope,
      this.getRuntimeDefinition(),
      `resolve tools for session ${session.externalSessionId}`,
    );
    if (policy.toolSelection.kind === "repository") {
      await requireOpencodeSessionPolicyRuntime({
        client: session.client,
        policy,
        workingDirectory: session.input.workingDirectory,
      });
      return resolveRepositoryToolSelection(this.getRuntimeDefinition());
    }

    const nowMs = Date.now();
    await ensureTrustedOdtMcpServerConnected({
      client: session.client,
      workingDirectory: session.input.workingDirectory,
      onReconnectStart: (event) => {
        this.emit(session.summary.externalSessionId, {
          type: "mcp_reconnect_started",
          externalSessionId: session.summary.externalSessionId,
          timestamp: this.now(),
          serverName: event.serverName,
          workingDirectory: event.workingDirectory,
          status: event.status,
          ...(event.errorDetails ? { errorDetails: event.errorDetails } : undefined),
        });
      },
    });

    if (
      session.workflowToolSelectionCache &&
      hasRuntimeType(session.workflowToolSelectionCachedAt, "number") &&
      nowMs - session.workflowToolSelectionCachedAt < WORKFLOW_TOOL_CACHE_TTL_MS
    ) {
      return session.workflowToolSelectionCache;
    }

    const selection = await resolveWorkflowToolSelection({
      client: session.client,
      role: policy.toolSelection.role,
      runtimeDescriptor: this.getRuntimeDefinition(),
      workingDirectory: session.input.workingDirectory,
      skipMcpConnectionCheck: true,
    });

    session.workflowToolSelectionCache = selection;
    session.workflowToolSelectionCachedAt = nowMs;
    return selection;
  }
}
