import { resolveClaudeQuerySession } from "./claude-agent-sdk-query-session";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSessionScope,
  ContinueInterruptedAgentTurnInput,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import {
  listClaudeModels,
  listClaudeSkills,
  listClaudeSlashCommands,
  listClaudeSubagents,
  loadClaudeHistory,
} from "./claude-agent-sdk-catalog";
import {
  type ClaudeWorkspaceFileSearch,
  createClaudeWorkspaceFileSearch,
  trackClaudeFileSearchSessions,
} from "./claude-agent-sdk-file-search";
import {
  type ClaudeContextUsageDependencies,
  flushClaudeLiveContextUsageRefresh,
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
import { applyClaudeSessionModel, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  type ClaudeSessionLaunchInput,
  continuedClaudeSessionLaunch,
  forkedClaudeSessionLaunch,
  freshClaudeSessionLaunch,
  requireClaudeOpenDucktorMcpForScope,
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
  ClaudeSession,
  ClaudeSessionContext,
  ClaudeSessionInput,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { fromPromise, unsupported } from "./claude-agent-sdk-utils";

type SessionScope = AgentSessionScope;
type SendInput = SendAgentUserMessageInput;

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

  constructor(
    private readonly input: CreateClaudeAgentSdkServiceInput,
    private readonly dependencies: ClaudeContextUsageDependencies,
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.randomId = input.randomId ?? randomUUID;
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

  dispose(): void {
    this.untrackFileSearchSessions();
    this.fileSearch.dispose();
  }

  startSession(input: StartAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "start Claude session").pipe(
      Effect.flatMap((scope) => this.start(input, runtimeId, scope)),
    );
  }

  resumeSession(input: ResumeAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "resume Claude session").pipe(
      Effect.flatMap((scope) => {
        const existing = this.sessionStore.get(input.externalSessionId);
        if (existing) {
          return fromPromise("claudeRuntime.resumeSession", async () => {
            assertClaudeSessionRef(existing, input, "resume");
            await requireClaudeOpenDucktorMcpForScope(scope, existing.query, {
              externalSessionId: existing.externalSessionId,
              runtimeId,
            });
            return existing.summary;
          });
        }
        return this.resume(input, runtimeId, scope);
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
        Effect.gen(this, function* () {
          const existing = this.sessionStore.get(input.externalSessionId);
          if (existing) {
            yield* checkLiveClaudeContinuationEligibility(existing, input, this.now);
          } else {
            yield* checkPersistedClaudeContinuationEligibility(input, this.now);
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
            Effect.tap(() =>
              Effect.sync(() => {
                if (existing) {
                  this.sessionStore.close(existing);
                }
              }),
            ),
            Effect.mapError((cause) =>
              resolveFailedClaudeContinuationSession({
                cause,
                existing,
                externalSessionId: input.externalSessionId,
                sessionStore: this.sessionStore,
              }),
            ),
          );
        }),
      ),
    );
  }

  forkSession(input: ForkAgentSessionInput, runtimeId: string) {
    return requireClaudeSessionScope(input.sessionScope, "fork Claude session").pipe(
      Effect.flatMap((scope) => this.fork(input, runtimeId, scope)),
    );
  }

  releaseSession(input: SessionRef) {
    return fromPromise("claudeRuntime.releaseSession", async () => {
      const session = this.sessionStore.get(input.externalSessionId);
      if (!session) {
        return;
      }
      assertClaudeSessionRef(session, input, "release");
      this.sessionStore.close(session);
      await flushClaudeLiveContextUsageRefresh(session);
    });
  }

  listAvailableModels(input: ListAgentModelsInput) {
    return fromPromise("claudeRuntime.listAvailableModels", () =>
      listClaudeModels(input, this.input.processEnv, this.input.claudeExecutablePath),
    );
  }
  listAvailableSlashCommands(input: ListAgentSlashCommandsInput) {
    return fromPromise("claudeRuntime.listAvailableSlashCommands", () =>
      listClaudeSlashCommands(input, this.input.processEnv, this.input.claudeExecutablePath),
    );
  }
  listAvailableSkills(input: ListAgentSkillsInput) {
    return fromPromise("claudeRuntime.listAvailableSkills", () =>
      listClaudeSkills(input, this.input.processEnv, this.input.claudeExecutablePath),
    );
  }
  listAvailableSubagents(input: ListAgentSubagentsInput) {
    return fromPromise("claudeRuntime.listAvailableSubagents", () =>
      listClaudeSubagents(input, this.input.processEnv, this.input.claudeExecutablePath),
    );
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
    const { target, session } = resolveClaudeQuerySession(this.sessionStore, input);
    const liveContext = session && !target.subpath ? claudeLiveHistoryContext(session) : undefined;
    return fromPromise("claudeRuntime.loadSessionHistory", () =>
      loadClaudeHistory(input, this.now, liveContext),
    );
  }

  loadSessionTodos(input: LoadAgentSessionTodosInput) {
    const { target, session } = resolveClaudeQuerySession(this.sessionStore, input);
    if (session && !target.subpath) {
      return Effect.succeed([...session.todosById.values()]);
    }
    return fromPromise("claudeRuntime.loadSessionTodos", () => loadClaudeTodos(input));
  }

  loadSessionContextUsage(input: LoadAgentSessionHistoryInput) {
    return loadClaudeSessionContextUsage({
      input,
      serviceInput: this.input,
      dependencies: this.dependencies,
      sessionStore: this.sessionStore,
    });
  }

  updateSessionModel(input: UpdateAgentSessionModelInput) {
    return fromPromise("claudeRuntime.updateSessionModel", async () => {
      const session = this.sessionStore.get(input.externalSessionId);
      if (!session) {
        return;
      }
      assertClaudeSessionRef(session, input, "update session model");
      const model =
        input.model && session.model?.profileId !== undefined
          ? { ...input.model, profileId: session.model.profileId }
          : input.model;
      await applyClaudeSessionModel(session, model);
      if (session.modelAfterQueuedTurns !== undefined) {
        session.modelAfterQueuedTurns = model ?? null;
      }
      session.summary = { ...session.summary };
    });
  }

  sendUserMessage(input: SendAgentUserMessageInput, runtimeId: string) {
    return Effect.gen(this, function* () {
      const scope = yield* requireClaudeSessionScope(
        input.sessionScope,
        "send Claude user message",
      );
      const session = yield* this.requireSessionForSend(input, runtimeId, scope);
      assertClaudeSessionRef(session, input, "send message");
      return yield* fromPromise("claudeRuntime.sendUserMessage", () =>
        sendClaudeUserMessage({
          messageInput: input,
          session,
          now: this.now,
          randomId: this.randomId,
          emit: this.emit.bind(this),
        }),
      );
    });
  }

  prepareApprovalReply(input: ReplyApprovalInput) {
    return fromPromise("claudeRuntime.prepareApprovalReply", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = this.requireSession(target.sessionId);
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
      const session = this.requireSession(target.sessionId);
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

  stopSession(input: SessionRef) {
    return this.sessionStore.stopSession(input);
  }

  probeSessionStatus(input: SessionRef) {
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

  private start(input: StartAgentSessionInput, runtimeId: string, scope: SessionScope) {
    const externalSessionId = this.randomId();
    return this.createSession(input, runtimeId, freshClaudeSessionLaunch(scope, externalSessionId));
  }

  private resume(input: ResumeAgentSessionInput, runtimeId: string, scope: SessionScope) {
    return this.createSession(
      input,
      runtimeId,
      resumedClaudeSessionLaunch(scope, input.externalSessionId),
    );
  }

  private fork(input: ForkAgentSessionInput, runtimeId: string, scope: SessionScope) {
    const externalSessionId = this.randomId();
    return this.createSession(
      input,
      runtimeId,
      forkedClaudeSessionLaunch(scope, externalSessionId, input.parentExternalSessionId),
    );
  }

  private createSession(
    input: ClaudeSessionInput,
    runtimeId: string,
    sessionInput: ClaudeSessionLaunchInput,
    onContinuationAdmission?: () => void,
  ) {
    return Effect.gen(this, function* () {
      const resumeSessionId = sessionInput.options.resume;
      const initialTodos = resumeSessionId
        ? yield* fromPromise("claudeRuntime.loadSessionTodos", () =>
            loadClaudeTodos({
              ...input,
              externalSessionId: resumeSessionId,
            }),
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
        sessionInput,
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

  private requireSession(externalSessionId: string): ClaudeSession {
    const session = this.sessionStore.get(externalSessionId);
    if (!session) {
      throw new HostValidationError({
        field: "externalSessionId",
        message: `Unknown Claude session '${externalSessionId}'.`,
        details: { externalSessionId },
      });
    }
    return session;
  }

  private requireSessionForSend(input: SendInput, runtimeId: string, scope: SessionScope) {
    const existing = this.sessionStore.get(input.externalSessionId);
    if (existing) {
      assertClaudeSessionRef(existing, input, "send message");
      return fromPromise("claudeRuntime.sendUserMessage", async () => {
        await requireClaudeOpenDucktorMcpForScope(scope, existing.query, {
          externalSessionId: existing.externalSessionId,
          runtimeId,
        });
        return existing;
      });
    }
    return Effect.gen(this, function* () {
      yield* this.createSession(
        input,
        runtimeId,
        resumedClaudeSessionLaunch(scope, input.externalSessionId),
      );
      return this.requireSession(input.externalSessionId);
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
