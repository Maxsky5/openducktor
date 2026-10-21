import {
  createClaudeTranscriptReader,
  type ManagedClaudeTranscriptReader,
} from "./claude-transcript-reader";
import {
  createClaudeTranscriptReadOwner,
  type ClaudeTranscriptReadOwner,
} from "./claude-transcript-read-owner";
import { resolveClaudePendingApprovalOwner } from "./claude-pending-approval-owner";
import { updateClaudeSessionModel } from "./claude-session-model-update";
import {
  resumeRetainedClaudeSession,
  updateClaudeSessionTitle,
} from "./claude-session-title-update";
import { getClaudeSessionMetadata, readClaudeSessionModel } from "./claude-session-metadata";
import { requireClaudeSession, resolveClaudeQuerySession } from "./claude-agent-sdk-query-session";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSessionControlUpdateTitleInput,
  ClaudeToolCatalogInput,
} from "@openducktor/contracts";
import { readClaudeToolCatalog } from "./claude-agent-sdk-tool-catalog";
import type {
  ContinueInterruptedAgentTurnInput,
  ForkAgentSessionInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  LoadAgentRuntimeCatalogInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateControlledAgentSessionModelInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import { loadClaudeHistory, loadClaudeRuntimeCatalog } from "./claude-agent-sdk-catalog";
import {
  type ClaudeWorkspaceFileSearch,
  createClaudeWorkspaceFileSearch,
  trackClaudeFileSearchSessions,
} from "./claude-agent-sdk-file-search";
import {
  type ClaudeContextUsageDependencies,
  loadClaudeSessionContextUsage,
} from "./claude-agent-sdk-context-usage";
import { loadClaudeDetachedSessionContextUsage } from "./claude-agent-sdk-detached-context";
import { claudeLiveHistoryContext } from "./claude-agent-sdk-history-loader";
import {
  prepareClaudeApprovalReply,
  prepareClaudeQuestionReply,
} from "./claude-agent-sdk-pending-input";
import {
  createClaudeAgentSdkSession,
  type CreateClaudeAgentSdkSessionInput,
} from "./claude-agent-sdk-session-factory";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  type ClaudeSessionLaunchInput,
  continuedClaudeSessionLaunch,
  forkedClaudeSessionLaunch,
  freshClaudeSessionLaunch,
  requireClaudeSessionScope,
  resumedClaudeSessionLaunch,
} from "./claude-agent-sdk-session-policy";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import {
  checkLiveClaudeContinuationEligibility,
  checkPersistedClaudeContinuationEligibility,
  resolveFailedClaudeContinuationSession,
} from "./claude-agent-sdk-service-continuation";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import type {
  ClaudeAgentSdkEvent,
  ClaudeAgentSdkService,
  ClaudeSessionContext,
  ClaudeSessionInput,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { fromPromise, fromSync, toClaudeServiceError, unsupported } from "./claude-agent-sdk-utils";

const defaultClaudeAgentSdkServiceDependencies: ClaudeContextUsageDependencies = {
  loadDetachedSessionContextUsage: (input) =>
    loadClaudeDetachedSessionContextUsage({ ...input, createQuery: query }),
};

class ClaudeAgentSdkServiceImpl implements ClaudeAgentSdkService {
  private readonly now: () => string;
  private readonly randomId: () => string;
  private readonly sessionStore: ClaudeSessionStore;
  private readonly fileSearch: ClaudeWorkspaceFileSearch;
  private readonly untrackFileSearchSessions: () => void;
  private readonly historyReader: ClaudeTranscriptReadOwner;
  private readonly transcriptReader: ManagedClaudeTranscriptReader;

  constructor(
    private readonly input: CreateClaudeAgentSdkServiceInput,
    private readonly dependencies: ClaudeContextUsageDependencies,
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.randomId = input.randomId ?? randomUUID;
    this.transcriptReader = createClaudeTranscriptReader({
      processEnv: input.processEnv ?? process.env,
      storage: input.historyStorage ?? "memory",
    });
    this.historyReader = createClaudeTranscriptReadOwner(this.transcriptReader);
    const sessionStoreInput: Parameters<typeof createClaudeAgentSdkSessionStore>[0] = {
      now: this.now,
    };
    if (input.emit) {
      sessionStoreInput.emit = input.emit;
    }
    this.sessionStore = input.sessionStore ?? createClaudeAgentSdkSessionStore(sessionStoreInput);
    this.fileSearch = input.fileSearch ?? createClaudeWorkspaceFileSearch();
    this.untrackFileSearchSessions = trackClaudeFileSearchSessions({
      fileSearch: this.fileSearch,
      sessionStore: this.sessionStore,
    });
  }

  dispose(): Effect.Effect<void> {
    return this.historyReader.dispose().pipe(
      Effect.andThen(
        Effect.sync(() => {
          this.transcriptReader.dispose();
          this.untrackFileSearchSessions();
          this.fileSearch.dispose();
        }),
      ),
    );
  }

  startSession(input: StartAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "start Claude session").pipe(
      Effect.flatMap((scope) =>
        this.createSession(input, runtimeId, freshClaudeSessionLaunch(scope, this.randomId())),
      ),
    );
  }

  resumeSession(input: ResumeAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "resume Claude session").pipe(
      Effect.flatMap((scope) => {
        const existing = this.sessionStore.get(input.externalSessionId);
        if (existing) {
          return fromPromise("claudeRuntime.resumeSession", () =>
            resumeRetainedClaudeSession({ request: input, runtimeId, scope, session: existing }),
          );
        }
        return this.createSession(
          input,
          runtimeId,
          resumedClaudeSessionLaunch(scope, input.externalSessionId),
        );
      }),
    );
  }

  continueInterruptedTurn(
    input: ContinueInterruptedAgentTurnInput,
    runtimeId: string,
    onContinuationAdmission?: () => void,
  ) {
    return requireClaudeSessionScope(input.sessionScope, "continue interrupted Claude turn").pipe(
      Effect.flatMap((scope) =>
        Effect.gen({ self: this }, function* () {
          const existing = this.sessionStore.get(input.externalSessionId);
          if (existing) {
            yield* checkLiveClaudeContinuationEligibility(
              existing,
              input,
              this.now,
              this.historyReader,
            );
          } else {
            yield* checkPersistedClaudeContinuationEligibility(input, this.now, this.historyReader);
          }
          // The replacement starts a new CLI process for the same session id. Keep the
          // attached session until the replacement is created, so a failed continuation
          // leaves the user with the session they already had. A session whose stream
          // ended in the meantime has no consumer, so it is dropped instead of restored.
          return yield* this.createSession(
            input,
            runtimeId,
            continuedClaudeSessionLaunch(scope, input.externalSessionId),
            onContinuationAdmission,
          ).pipe(
            Effect.catch((cause) =>
              resolveFailedClaudeContinuationSession({
                cause,
                existing,
                externalSessionId: input.externalSessionId,
                sessionStore: this.sessionStore,
              }),
            ),
            Effect.tap(() => (existing ? this.sessionStore.settle(existing) : Effect.void)),
          );
        }),
      ),
    );
  }

  forkSession(input: ForkAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "fork Claude session").pipe(
      Effect.flatMap((scope) =>
        this.createSession(
          input,
          runtimeId,
          forkedClaudeSessionLaunch(scope, this.randomId(), input.parentExternalSessionId),
        ),
      ),
    );
  }

  releaseSession(input: SessionRef) {
    return Effect.gen({ self: this }, function* () {
      const session = this.sessionStore.getForCleanup(input.externalSessionId);
      if (!session) {
        return;
      }
      yield* Effect.try({
        try: () => assertClaudeSessionRef(session, input, "release"),
        catch: (cause) => toHostOperationError(cause, "claudeRuntime.releaseSession"),
      });
      yield* this.sessionStore.settle(session);
    }).pipe(Effect.withSpan("claudeRuntime.releaseSession"));
  }

  loadRuntimeCatalog(input: LoadAgentRuntimeCatalogInput) {
    return fromPromise("claudeRuntime.loadRuntimeCatalog", () =>
      loadClaudeRuntimeCatalog(
        input,
        this.input.processEnv,
        this.input.claudeExecutablePath,
        query,
      ),
    );
  }

  loadToolCatalog(input: ClaudeToolCatalogInput) {
    return readClaudeToolCatalog(input, this.input);
  }

  searchFiles(input: SearchAgentFilesInput) {
    return fromPromise("claudeRuntime.searchFiles", () => this.fileSearch.search(input));
  }

  resolveSessionParent(input: SessionRef) {
    return fromPromise("claudeRuntime.resolveSessionParent", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      return target.subpath ? target.sessionId : null;
    });
  }

  loadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const { session } = resolveClaudeQuerySession(this.sessionStore, input);
    const liveContext = session
      ? claudeLiveHistoryContext(session, input.externalSessionId)
      : undefined;
    return loadClaudeHistory(input, this.now, liveContext, { reader: this.historyReader }).pipe(
      Effect.mapError((cause) => toClaudeServiceError("claudeRuntime.loadSessionHistory", cause)),
    );
  }

  loadSessionTodos(input: LoadAgentSessionTodosInput) {
    const { target, session } = resolveClaudeQuerySession(this.sessionStore, input);
    if (session && !target.subpath) {
      return Effect.succeed([...session.todosById.values()]);
    }
    return loadClaudeTodos(input, { reader: this.historyReader }).pipe(
      Effect.mapError((cause) => toClaudeServiceError("claudeRuntime.loadSessionTodos", cause)),
    );
  }

  loadSessionContextUsage(input: LoadAgentSessionHistoryInput) {
    return loadClaudeSessionContextUsage({
      input,
      serviceInput: this.input,
      dependencies: this.dependencies,
      sessionStore: this.sessionStore,
    });
  }

  inspectSessionForImport(input: SessionRef, runtimeId: string) {
    return Effect.gen({ self: this }, function* () {
      const metadata = yield* fromPromise("claudeRuntime.getSessionMetadata", () =>
        getClaudeSessionMetadata(input),
      );
      const selectedModel = yield* fromPromise("claudeRuntime.readSessionModel", () =>
        readClaudeSessionModel(input),
      );
      return {
        metadata,
        selectedModel,
        attach: this.createSession(
          {
            ...input,
            runtimeKind: "claude",
            sessionScope: { kind: "repository" },
            runtimePolicy: { kind: "claude" },
            systemPrompt: "",
          },
          runtimeId,
          {
            externalSessionId: input.externalSessionId,
            options: { resume: input.externalSessionId },
            preserveNativeSettings: true,
            startedMessage: "Imported session",
          },
        ),
      };
    });
  }

  updateSessionModel(input: UpdateControlledAgentSessionModelInput, runtimeId: string) {
    return updateClaudeSessionModel(input, {
      sessionStore: this.sessionStore,
      attach: (request, launch) => this.createSession(request, runtimeId, launch),
    });
  }

  updateSessionTitle(input: AgentSessionControlUpdateTitleInput) {
    return updateClaudeSessionTitle(input, { sessionStore: this.sessionStore });
  }

  sendUserMessage(
    input: SendAgentUserMessageInput,
    _runtimeId: string,
    options?: AgentSessionSendOptions,
  ) {
    return Effect.gen({ self: this }, function* () {
      const session = yield* fromSync("claudeRuntime.sendUserMessage", () => {
        const retained = requireClaudeSession(this.sessionStore, input.externalSessionId);
        assertClaudeSessionRef(retained, input, "send message");
        return retained;
      });
      return yield* fromPromise("claudeRuntime.sendUserMessage", () =>
        sendClaudeUserMessage({
          messageInput: input,
          session,
          now: this.now,
          randomId: this.randomId,
          emit: this.emit.bind(this),
          onSent: options?.onSent,
          assertCurrent: options?.assertCurrent,
        }),
      );
    });
  }

  resolvePendingApproval(input: Parameters<ClaudeAgentSdkService["resolvePendingApproval"]>[0]) {
    return fromPromise("claudeRuntime.resolvePendingApproval", async () =>
      resolveClaudePendingApprovalOwner(this.sessionStore, input),
    );
  }

  prepareApprovalReply(input: ReplyApprovalInput) {
    return fromPromise("claudeRuntime.prepareApprovalReply", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = requireClaudeSession(this.sessionStore, target.sessionId);
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "reply to approval",
      );
      return prepareClaudeApprovalReply({
        input,
        now: this.now,
        session,
      });
    });
  }

  prepareQuestionReply(input: ReplyQuestionInput) {
    return fromPromise("claudeRuntime.prepareQuestionReply", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = requireClaudeSession(this.sessionStore, target.sessionId);
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "reply to question",
      );
      return prepareClaudeQuestionReply({
        input,
        now: this.now,
        session,
      });
    });
  }

  stopSession(input: RuntimeSessionTarget) {
    return this.sessionStore.stopSession(input);
  }

  probeSessionStatus(input: RuntimeSessionTarget) {
    return this.sessionStore.probeSessionStatus(input);
  }

  loadSessionDiff(_input: LoadAgentSessionDiffInput) {
    return fromPromise("claudeRuntime.loadSessionDiff", async () => unsupported("session diff"));
  }

  loadFileStatus(_input: LoadAgentFileStatusInput) {
    return fromPromise("claudeRuntime.loadFileStatus", async () => unsupported("file status"));
  }

  stopSessionsForRuntime(runtimeId: string) {
    return this.sessionStore.stopSessionsForRuntime(runtimeId);
  }

  private createSession(
    input: ClaudeSessionInput,
    runtimeId: string,
    sessionInput: ClaudeSessionLaunchInput,
    onContinuationAdmission?: () => void,
  ) {
    return Effect.gen({ self: this }, function* () {
      const isNew = !sessionInput.options.resume || sessionInput.options.forkSession === true;
      const claudePolicy = isNew
        ? yield* this.input.launchPolicy.resolve({
            role: input.sessionScope.kind === "workflow" ? input.sessionScope.role : null,
          })
        : null;
      const launchSessionInput = { ...sessionInput, claudePolicy };
      const resumeSessionId = sessionInput.options.resume;
      const initialTodos = resumeSessionId
        ? yield* loadClaudeTodos(
            {
              ...input,
              externalSessionId: resumeSessionId,
            },
            { reader: this.historyReader },
          ).pipe(
            Effect.mapError((cause) =>
              toClaudeServiceError("claudeRuntime.loadSessionTodos", cause),
            ),
          )
        : [];
      const mcpCommand = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution: this.input.runtimeDistribution,
        toolDiscovery: this.input.toolDiscovery,
      }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.resolveMcpCommand", {
            repoPath: input.repoPath,
          }),
        ),
      );
      const mcpBridgeConnection = yield* this.input.resolveMcpBridgeConnection(input.repoPath);
      yield* fromPromise("claudeRuntime.prewarmFileSearch", async () => {
        this.fileSearch.prewarm(input.workingDirectory);
      });
      const createSessionInput: CreateClaudeAgentSdkSessionInput = {
        emit: this.emit.bind(this),
        initialTodos,
        input,
        now: this.now,
        randomId: this.randomId,
        resolvedDependencies: {
          claudeExecutablePath: this.input.claudeExecutablePath,
          mcpBridgeConnection,
          mcpCommand,
        },
        runtimeId,
        serviceInput: this.input,
        sessionInput: launchSessionInput,
        sessionStore: this.sessionStore,
      };
      if (onContinuationAdmission) {
        createSessionInput.onContinuationAdmission = onContinuationAdmission;
      }
      return yield* fromPromise("claudeRuntime.createSession", () =>
        createClaudeAgentSdkSession(createSessionInput),
      );
    });
  }

  private emit(session: ClaudeSessionContext, event: ClaudeAgentSdkEvent): void {
    this.input.emit?.(session, event);
  }
}

export const createClaudeAgentSdkService = (
  input: CreateClaudeAgentSdkServiceInput,
  dependencies: ClaudeContextUsageDependencies = defaultClaudeAgentSdkServiceDependencies,
): ClaudeAgentSdkService => new ClaudeAgentSdkServiceImpl(input, dependencies);

export type { ClaudeAgentSdkService, CreateClaudeAgentSdkServiceInput };
