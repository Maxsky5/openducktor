import { randomUUID } from "node:crypto";
import {
  type ForkAgentSessionInput,
  formatWorkflowAgentSessionTitle,
  type ListAgentModelsInput,
  type ListAgentSkillsInput,
  type ListAgentSlashCommandsInput,
  type ListAgentSubagentsInput,
  type LoadAgentFileStatusInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type ReplyApprovalInput,
  type ReplyQuestionInput,
  type ResumeAgentSessionInput,
  type SearchAgentFilesInput,
  type SendAgentUserMessageInput,
  type SessionRef,
  type StartAgentSessionInput,
  type UpdateAgentSessionModelInput,
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
import { readClaudeContextUsageFromQuery } from "./claude-agent-sdk-context-usage";
import { replyClaudeApproval, replyClaudeQuestion } from "./claude-agent-sdk-pending-input";
import { resolveClaudeExecutable } from "./claude-agent-sdk-runtime";
import { createClaudeAgentSdkSession } from "./claude-agent-sdk-session-factory";
import { applyClaudeSessionModel, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
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
import { claudeWorkflowScope, fromPromise, unsupported } from "./claude-agent-sdk-utils";

class ClaudeAgentSdkServiceImpl implements ClaudeAgentSdkService {
  private readonly now: () => string;
  private readonly randomId: () => string;
  private readonly sessionStore: ClaudeSessionStore;

  constructor(private readonly input: CreateClaudeAgentSdkServiceInput) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.randomId = input.randomId ?? randomUUID;
    this.sessionStore =
      input.sessionStore ??
      createClaudeAgentSdkSessionStore({
        now: this.now,
        ...(input.emit ? { emit: input.emit } : {}),
      });
  }

  startSession(input: StartAgentSessionInput, runtimeId: string) {
    return this.start(input, runtimeId);
  }

  resumeSession(input: ResumeAgentSessionInput, runtimeId: string) {
    const existing = this.sessionStore.get(input.externalSessionId);
    if (existing) {
      return fromPromise("claudeRuntime.resumeSession", async () => {
        assertClaudeSessionRef(existing, input, "resume");
        return existing.summary;
      });
    }
    return this.resume(input, runtimeId);
  }

  forkSession(input: ForkAgentSessionInput, runtimeId: string) {
    return this.fork(input, runtimeId);
  }

  releaseSession(input: SessionRef) {
    return fromPromise("claudeRuntime.releaseSession", async () => {
      const session = this.sessionStore.get(input.externalSessionId);
      if (!session) {
        return;
      }
      assertClaudeSessionRef(session, input, "release");
      this.sessionStore.close(session);
    });
  }

  listAvailableModels(input: ListAgentModelsInput) {
    const service = this;
    return Effect.gen(function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        service.input,
        "claudeRuntime.listAvailableModels",
      );
      return yield* fromPromise("claudeRuntime.listAvailableModels", () =>
        listClaudeModels(input, service.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSlashCommands(input: ListAgentSlashCommandsInput) {
    const service = this;
    return Effect.gen(function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        service.input,
        "claudeRuntime.listAvailableSlashCommands",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSlashCommands", () =>
        listClaudeSlashCommands(input, service.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSkills(input: ListAgentSkillsInput) {
    const service = this;
    return Effect.gen(function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        service.input,
        "claudeRuntime.listAvailableSkills",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSkills", () =>
        listClaudeSkills(input, service.input.processEnv, claudeExecutablePath),
      );
    });
  }
  listAvailableSubagents(input: ListAgentSubagentsInput) {
    const service = this;
    return Effect.gen(function* () {
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        service.input,
        "claudeRuntime.listAvailableSubagents",
      );
      return yield* fromPromise("claudeRuntime.listAvailableSubagents", () =>
        listClaudeSubagents(input, service.input.processEnv, claudeExecutablePath),
      );
    });
  }

  searchFiles(input: SearchAgentFilesInput) {
    return fromPromise("claudeRuntime.searchFiles", () => searchClaudeWorkspaceFiles(input));
  }

  loadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const service = this;
    return Effect.gen(function* () {
      const session = service.sessionStore.get(input.externalSessionId);
      const claudeExecutablePath = yield* resolveClaudeExecutable(
        service.input,
        "claudeRuntime.loadSessionHistory",
      );
      return yield* fromPromise("claudeRuntime.loadSessionHistory", () =>
        loadClaudeHistory(input, service.now, session?.acceptedUserMessages, async () => {
          const catalog = await listClaudeSkills(
            input,
            service.input.processEnv,
            claudeExecutablePath,
          );
          return catalog.skills;
        }),
      );
    });
  }

  loadSessionTodos(input: LoadAgentSessionTodosInput) {
    const target = parseClaudeTranscriptTarget(input.externalSessionId);
    if (!target.subpath) {
      const session = this.sessionStore.get(target.sessionId);
      if (session) {
        assertClaudeSessionRef(session, input, "load session todos");
        return Effect.succeed([...session.todosById.values()]);
      }
    }
    return fromPromise("claudeRuntime.loadSessionTodos", () => loadClaudeTodos(input));
  }

  loadSessionContextUsage(input: LoadAgentSessionHistoryInput) {
    return fromPromise("claudeRuntime.loadSessionContextUsage", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = this.sessionStore.get(target.sessionId);
      if (!session) {
        return null;
      }
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "load session context usage",
      );
      const usage = await readClaudeContextUsageFromQuery(session.query);
      return usage ? { totalTokens: usage.usedTokens, contextWindow: usage.maxTokens } : null;
    });
  }

  updateSessionModel(input: UpdateAgentSessionModelInput) {
    return fromPromise("claudeRuntime.updateSessionModel", async () => {
      const session = this.requireSession(input.externalSessionId);
      assertClaudeSessionRef(session, input, "update session model");
      await applyClaudeSessionModel(session, input.model);
      session.summary = { ...session.summary };
    });
  }

  sendUserMessage(input: SendAgentUserMessageInput, runtimeId: string) {
    const service = this;
    return Effect.gen(function* () {
      const session = yield* service.requireSessionForSend(input, runtimeId);
      assertClaudeSessionRef(session, input, "send message");
      return yield* fromPromise("claudeRuntime.sendUserMessage", () =>
        sendClaudeUserMessage({
          messageInput: input,
          session,
          now: service.now,
          randomId: service.randomId,
          emit: service.emit.bind(service),
        }),
      );
    });
  }

  replyApproval(input: ReplyApprovalInput) {
    return fromPromise("claudeRuntime.replyApproval", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = this.requireSession(target.sessionId);
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "reply to approval",
      );
      replyClaudeApproval({
        emit: this.emit.bind(this),
        input,
        now: this.now,
        session,
      });
    });
  }

  replyQuestion(input: ReplyQuestionInput) {
    return fromPromise("claudeRuntime.replyQuestion", async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      const session = this.requireSession(target.sessionId);
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "reply to question",
      );
      replyClaudeQuestion({
        emit: this.emit.bind(this),
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

  private start(input: StartAgentSessionInput, runtimeId: string) {
    const externalSessionId = this.randomId();
    const { role, taskId } = input.sessionScope;
    return this.createSession(input, runtimeId, {
      externalSessionId,
      startedMessage: `Started ${role} session`,
      title: formatWorkflowAgentSessionTitle(role, taskId),
      options: { sessionId: externalSessionId },
    });
  }

  private resume(input: ResumeAgentSessionInput, runtimeId: string) {
    const existing = this.sessionStore.get(input.externalSessionId);
    if (existing) {
      assertClaudeSessionRef(existing, input, "resume");
      return Effect.succeed(existing.summary);
    }
    const title = this.workflowSessionTitle(input);
    const scope = claudeWorkflowScope(input);
    return this.createSession(input, runtimeId, {
      externalSessionId: input.externalSessionId,
      startedMessage: `Resumed ${scope?.role ?? "Claude"} session`,
      ...(title ? { title } : {}),
      options: { resume: input.externalSessionId },
    });
  }

  private fork(input: ForkAgentSessionInput, runtimeId: string) {
    const externalSessionId = this.randomId();
    const { role, taskId } = input.sessionScope;
    return this.createSession(input, runtimeId, {
      externalSessionId,
      parentExternalSessionId: input.parentExternalSessionId,
      startedMessage: `Forked ${role} session`,
      title: formatWorkflowAgentSessionTitle(role, taskId),
      options: {
        resume: input.parentExternalSessionId,
        forkSession: true,
        sessionId: externalSessionId,
      },
    });
  }

  private createSession(
    input: ClaudeSessionInput,
    runtimeId: string,
    sessionInput: {
      externalSessionId: string;
      options: Parameters<typeof createClaudeAgentSdkSession>[0]["sessionInput"]["options"];
      parentExternalSessionId?: string;
      startedMessage: string;
      title?: string;
    },
  ) {
    const service = this;
    return Effect.gen(function* () {
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
        service.input,
        "claudeRuntime.createSession",
      );
      const mcpCommand = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution: service.input.runtimeDistribution,
        toolDiscovery: service.input.toolDiscovery,
      }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.resolveMcpCommand", {
            repoPath: input.repoPath,
          }),
        ),
      );
      const mcpBridgeConnection = yield* service.input.resolveMcpBridgeConnection(input.repoPath);
      return yield* fromPromise("claudeRuntime.createSession", () =>
        createClaudeAgentSdkSession({
          emit: service.emit.bind(service),
          initialTodos,
          input,
          now: service.now,
          randomId: service.randomId,
          resolvedDependencies: {
            claudeExecutablePath,
            mcpBridgeConnection,
            mcpCommand,
          },
          runtimeId,
          serviceInput: service.input,
          sessionInput,
          sessionStore: service.sessionStore,
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

  private requireSessionForSend(input: SendAgentUserMessageInput, runtimeId: string) {
    const existing = this.sessionStore.get(input.externalSessionId);
    if (existing) {
      return Effect.succeed(existing);
    }
    const service = this;
    return Effect.gen(function* () {
      const title = service.workflowSessionTitle(input);
      const scope = claudeWorkflowScope(input);
      yield* service.createSession(input, runtimeId, {
        externalSessionId: input.externalSessionId,
        startedMessage: `Resumed ${scope?.role ?? "Claude"} session`,
        ...(title ? { title } : {}),
        options: { resume: input.externalSessionId },
      });
      return service.requireSession(input.externalSessionId);
    });
  }

  private workflowSessionTitle(input: ClaudeSessionInput): string | undefined {
    const scope = claudeWorkflowScope(input);
    return scope ? formatWorkflowAgentSessionTitle(scope.role, scope.taskId) : undefined;
  }

  private emit(session: ClaudeSessionContext, event: ClaudeAgentSdkEvent): void {
    this.input.emit?.(session, event);
  }
}

export const createClaudeAgentSdkService = (
  input: CreateClaudeAgentSdkServiceInput,
): ClaudeAgentSdkService => new ClaudeAgentSdkServiceImpl(input);

export type { ClaudeAgentSdkService, CreateClaudeAgentSdkServiceInput };
