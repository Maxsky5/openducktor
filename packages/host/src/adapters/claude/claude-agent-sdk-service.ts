import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSessionScope,
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
  searchClaudeWorkspaceFiles,
} from "./claude-agent-sdk-catalog";
import {
  flushClaudeLiveContextUsageRefresh,
  readClaudeContextUsageFromQuery,
} from "./claude-agent-sdk-context-usage";
import { loadClaudeDetachedSessionContextUsage } from "./claude-agent-sdk-detached-context";
import {
  prepareClaudeApprovalReply,
  prepareClaudeQuestionReply,
} from "./claude-agent-sdk-pending-input";
import { resolveClaudeExecutable } from "./claude-agent-sdk-runtime";
import { createClaudeAgentSdkSession } from "./claude-agent-sdk-session-factory";
import { applyClaudeSessionModel, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  type ClaudeSessionLaunchInput,
  forkedClaudeSessionLaunch,
  freshClaudeSessionLaunch,
  requireClaudeOpenDucktorMcpForScope,
  requireClaudeSessionScope,
  resumedClaudeSessionLaunch,
} from "./claude-agent-sdk-session-policy";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
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

type ClaudeAgentSdkServiceDependencies = {
  loadDetachedSessionContextUsage: (
    input: Omit<Parameters<typeof loadClaudeDetachedSessionContextUsage>[0], "createQuery">,
  ) => ReturnType<typeof loadClaudeDetachedSessionContextUsage>;
};

type SessionScope = AgentSessionScope;
type SendInput = SendAgentUserMessageInput;

const defaultClaudeAgentSdkServiceDependencies: ClaudeAgentSdkServiceDependencies = {
  loadDetachedSessionContextUsage: (input) =>
    loadClaudeDetachedSessionContextUsage({ ...input, createQuery: query }),
};

class ClaudeAgentSdkServiceImpl implements ClaudeAgentSdkService {
  private readonly now: () => string;
  private readonly randomId: () => string;
  private readonly sessionStore: ClaudeSessionStore;

  constructor(
    private readonly input: CreateClaudeAgentSdkServiceInput,
    private readonly dependencies: ClaudeAgentSdkServiceDependencies,
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
    return Effect.gen(this, function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.listAvailableModels",
      );
      return yield* fromPromise("claudeRuntime.listAvailableModels", () =>
        listClaudeModels(input, this.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSlashCommands(input: ListAgentSlashCommandsInput) {
    return Effect.gen(this, function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.listAvailableSlashCommands",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSlashCommands", () =>
        listClaudeSlashCommands(input, this.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSkills(input: ListAgentSkillsInput) {
    return Effect.gen(this, function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.listAvailableSkills",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSkills", () =>
        listClaudeSkills(input, this.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSubagents(input: ListAgentSubagentsInput) {
    return Effect.gen(this, function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.listAvailableSubagents",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSubagents", () =>
        listClaudeSubagents(input, this.input.processEnv, claudeExecutablePath),
      );
    });
  }

  searchFiles(input: SearchAgentFilesInput) {
    return fromPromise("claudeRuntime.searchFiles", () => searchClaudeWorkspaceFiles(input));
  }

  loadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const target = parseClaudeTranscriptTarget(input.externalSessionId);
    const session = this.sessionStore.get(target.sessionId);
    if (session) {
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: target.sessionId },
        "load session history",
      );
    }
    const liveContext =
      session && !target.subpath
        ? {
            source:
              "externalSessionId" in session.input || "parentExternalSessionId" in session.input
                ? ("persisted" as const)
                : ("fresh" as const),
            userMessages: session.acceptedUserMessages.map((message) => ({
              ...message,
              state: session.queuedSdkMessages.some(
                (queuedMessage) => queuedMessage.uuid === message.messageId,
              )
                ? ("queued" as const)
                : ("read" as const),
            })),
          }
        : undefined;
    return fromPromise("claudeRuntime.loadSessionHistory", () =>
      loadClaudeHistory(input, this.now, liveContext),
    );
  }

  loadSessionTodos(input: LoadAgentSessionTodosInput) {
    const target = parseClaudeTranscriptTarget(input.externalSessionId);
    const session = this.sessionStore.get(target.sessionId);
    if (session) {
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: target.sessionId },
        "load session todos",
      );
    }
    if (session && !target.subpath) {
      return Effect.succeed([...session.todosById.values()]);
    }
    return fromPromise("claudeRuntime.loadSessionTodos", () => loadClaudeTodos(input));
  }

  loadSessionContextUsage(input: LoadAgentSessionHistoryInput) {
    return Effect.gen(this, function* () {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      if (target.subpath) {
        return null;
      }
      const session = this.sessionStore.get(target.sessionId);
      if (session) {
        return yield* fromPromise("claudeRuntime.loadSessionContextUsage", async () => {
          assertClaudeSessionRef(
            session,
            { ...input, externalSessionId: session.externalSessionId },
            "load session context usage",
          );
          if (input.sessionScope) {
            await requireClaudeOpenDucktorMcpForScope(input.sessionScope, session.query, {
              externalSessionId: session.externalSessionId,
              runtimeId: session.runtimeId,
            });
          }
          const usage = await readClaudeContextUsageFromQuery(session.query);
          return usage ? { totalTokens: usage.usedTokens, contextWindow: usage.maxTokens } : null;
        });
      }
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.loadSessionContextUsage",
      );
      const detachedUsageInput: Parameters<
        ClaudeAgentSdkServiceDependencies["loadDetachedSessionContextUsage"]
      >[0] = {
        claudeExecutablePath,
        externalSessionId: target.sessionId,
        workingDirectory: input.workingDirectory,
      };
      if (this.input.processEnv) {
        detachedUsageInput.processEnv = this.input.processEnv;
      }
      return yield* fromPromise("claudeRuntime.loadSessionContextUsage", () =>
        this.dependencies.loadDetachedSessionContextUsage(detachedUsageInput),
      );
    });
  }

  updateSessionModel(input: UpdateAgentSessionModelInput) {
    return fromPromise("claudeRuntime.updateSessionModel", async () => {
      const session = this.sessionStore.get(input.externalSessionId);
      if (!session) {
        return;
      }
      assertClaudeSessionRef(session, input, "update session model");
      await applyClaudeSessionModel(session, input.model);
      if (session.modelAfterQueuedTurns !== undefined) {
        session.modelAfterQueuedTurns = input.model ?? null;
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
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        this.input,
        "claudeRuntime.createSession",
      );
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
      return yield* fromPromise("claudeRuntime.createSession", () =>
        createClaudeAgentSdkSession({
          emit: this.emit.bind(this),
          initialTodos,
          input,
          now: this.now,
          randomId: this.randomId,
          resolvedDependencies: {
            claudeExecutablePath,
            mcpBridgeConnection,
            mcpCommand,
          },
          runtimeId,
          serviceInput: this.input,
          sessionInput,
          sessionStore: this.sessionStore,
        }),
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
  dependencies: ClaudeAgentSdkServiceDependencies = defaultClaudeAgentSdkServiceDependencies,
): ClaudeAgentSdkService => new ClaudeAgentSdkServiceImpl(input, dependencies);

export type { ClaudeAgentSdkService, CreateClaudeAgentSdkServiceInput };
