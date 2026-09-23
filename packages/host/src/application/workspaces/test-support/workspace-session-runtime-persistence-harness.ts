import type {
  AcceptedAgentUserMessage,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlUpdateModelInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionTranscriptEvent,
  WorkspaceSession,
} from "@openducktor/contracts";
import { repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../../adapters/agent-sessions/live-session-adapter-registry";
import type { SqliteTaskStoreTestHarness } from "../../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../../adapters/sqlite/sqlite-workspace-session-store";
import { type HostError, HostOperationError } from "../../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../../ports/agent-session-live-adapter-port";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../../test-support/service-test-doubles";
import { createAgentSessionCommandService } from "../../agent-sessions/agent-session-command-service";
import { createAgentSessionLiveStateService } from "../../agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionOperationGate } from "../workspace-session-operation-gate";
import { createWorkspaceSessionRuntimePersistence } from "../workspace-session-runtime-persistence";
import { createWorkspaceSessionService } from "../workspace-session-service";

export const waitFor = async (check: () => Promise<boolean> | boolean, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out while waiting for the condition.");
};

export const createPersistenceHarness = async (database: SqliteTaskStoreTestHarness) => {
  const ref: AgentSessionLiveRef = {
    repoPath: database.repoPath,
    runtimeKind: "opencode",
    externalSessionId: "native",
    workingDirectory: `${database.repoPath}/session-worktree`,
  };
  const storeRef = {
    repoPath: database.repoPath,
    workspaceId: "fairnest",
    sessionId: "session-1",
  };
  const record: WorkspaceSession = {
    id: "session-1",
    runtimeKind: "opencode",
    externalSessionId: "native",
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: ref.workingDirectory,
      branchName: "feature/session",
      worktreeState: "present",
    },
    roleSnapshot: {
      id: "deleted-role",
      name: "Original role",
      systemPrompt: "Original instructions.",
    },
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "provider",
      modelId: "stored-model",
      variant: "high",
    },
    generatedTitle: null,
    manualTitle: null,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  };
  const store = createSqliteWorkspaceSessionStore(database.contextProvider);
  await Effect.runPromise(store.create({ ...storeRef, session: record }));
  const updates: Array<{ workspaceId: string; session: WorkspaceSession }> = [];
  const events: AgentSessionLiveEnvelope[] = [];
  const inputs: Array<AgentSessionControlSendInput | AgentSessionControlResumeInput> = [];
  const activityTimes: number[] = [];
  const models: AgentSessionControlUpdateModelInput["model"][] = [];
  const titleAttempts: string[] = [];
  const state = {
    failSend: false,
    failModel: false,
    failModelSave: false,
    failRestore: false,
    failTitle: false,
    failTitleWrite: false,
    titleNotAttached: false,
    failPublish: false,
    failActivity: false,
    publishAcceptedMessageDuringSend: false,
    registered: true,
    beforeControl: Effect.void,
    beforeModelSave: Effect.void,
    beforeTitle: Effect.void,
    onGateRequest: () => {},
    active: false,
  };
  const renameFailures: string[] = [];
  const failure = (message: string) =>
    Effect.fail(new HostOperationError({ operation: "test", message }));
  const accepted = (
    text = "First accepted prompt",
    timestamp = "2026-09-07T10:00:00Z",
  ): AcceptedAgentUserMessage => ({
    type: "user_message",
    externalSessionId: "native",
    sessionRef: ref,
    timestamp,
    messageId: "user-1",
    message: text,
    parts: [{ kind: "text", text }],
    state: "read",
  });
  const baseGate = createWorkspaceSessionOperationGate();
  const operationGate: ReturnType<typeof createWorkspaceSessionOperationGate> = {
    run: (ref, effect) =>
      Effect.sync(() => state.onGateRequest()).pipe(Effect.zipRight(baseGate.run(ref, effect))),
  };
  const sessionTitleGate = createWorkspaceSessionOperationGate();
  let updateLiveRuntimeTitle:
    | ((title: string) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>)
    | null = null;
  const persistence = createWorkspaceSessionRuntimePersistence({
    updateRuntimeSessionTitle: ({ title }) =>
      updateLiveRuntimeTitle
        ? updateLiveRuntimeTitle(title)
        : Effect.dieMessage("live title update is not wired"),
    operationGate,
    sessionTitleGate,
    store: {
      ...store,
      recordAcceptedMessage: (input) =>
        state.failActivity
          ? failure("activity write failed")
          : state.failTitleWrite && input.generatedTitle !== null
            ? failure("title write failed")
            : store.recordAcceptedMessage(input),
      setSelectedModel: (input) =>
        state.beforeModelSave.pipe(
          Effect.zipRight(
            Effect.suspend(() =>
              state.failModelSave ? failure("model save failed") : store.setSelectedModel(input),
            ),
          ),
        ),
      recordActivity: (input) => {
        activityTimes.push(input.activity.occurredAt);
        return state.failActivity ? failure("activity write failed") : store.recordActivity(input);
      },
    },
    settings: {
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "fairnest",
            workspaceName: "Fairnest",
            repoPath: database.repoPath,
          }),
        ),
    },
    git: createGitPortTestDouble({
      canonicalizePath: (value) => Effect.succeed(value),
      isGitRepository: () => Effect.succeed(true),
      shareGitCommonDirectory: () => Effect.succeed(true),
      isRegisteredWorktree: () => Effect.succeed(state.registered),
    }),
    publishUpdated: (workspaceId, session) =>
      Effect.suspend(() =>
        state.failPublish
          ? failure("publication failed")
          : Effect.sync(() => {
              updates.push({ workspaceId, session });
            }),
      ),
    reportRenameFailure: (_runtimeRef, message) =>
      Effect.sync(() => {
        renameFailures.push(message);
      }),
  });
  const live = createAgentSessionLiveStateService({
    adapterRegistry: createLiveSessionAdapterRegistry(),
    persistence,
    faultLog: () => Effect.void,
    publish: (event) => {
      events.push(event);
    },
  });
  updateLiveRuntimeTitle = (title) => live.updateSessionTitle({ ...ref, title });
  const registration = live.createRuntimeRegistration({
    runtimeId: "runtime",
    runtimeKind: "opencode",
    repoPath: database.repoPath,
  });
  await Effect.runPromise(
    live.registerRuntimeAdapter(
      createAgentSessionRuntimeAdapterTestDouble(registration, {
        matches: () => true,
        listSnapshots: () => Effect.succeed([]),
        listRetainedSnapshots: () => Effect.succeed([]),
        resumeSession: (input) =>
          state.beforeControl.pipe(
            Effect.zipRight(
              Effect.sync(() => {
                inputs.push(input);
                return {
                  externalSessionId: input.externalSessionId,
                  runtimeKind: input.runtimeKind,
                  workingDirectory: input.workingDirectory,
                  startedAt: "2026-09-07T10:00:00Z",
                  status: "idle",
                };
              }),
            ),
          ),
        sendUserMessage: (input) =>
          state.beforeControl.pipe(
            Effect.zipRight(
              Effect.suspend(() => {
                inputs.push(input);
                if (state.failSend) return failure("runtime rejected message");
                const acceptedMessage = accepted();
                if (!state.publishAcceptedMessageDuringSend) return Effect.succeed(acceptedMessage);
                return registration
                  .runMutation(
                    Effect.succeed({
                      value: undefined,
                      changes: [
                        {
                          type: "transcript_event" as const,
                          event: { ...acceptedMessage, sessionRef: ref },
                        },
                      ],
                    }),
                  )
                  .pipe(Effect.as(acceptedMessage));
              }),
            ),
          ),
        updateSessionModel: (input) =>
          Effect.suspend(() => {
            models.push(input.model);
            if (state.failModel) return failure("runtime rejected model");
            if (state.failRestore && models.length === 2) return failure("runtime restore failed");
            return Effect.void;
          }),
        updateSessionTitle: (input) =>
          state.beforeTitle.pipe(
            Effect.zipRight(
              Effect.suspend((): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> => {
                titleAttempts.push(input.title);
                if (state.failTitle) return failure("runtime title update failed");
                if (state.titleNotAttached) return Effect.succeed({ status: "not_attached" });
                return Effect.succeed({ status: "renamed" });
              }),
            ),
          ),
      }),
    ),
  );
  events.length = 0;
  const commands = createAgentSessionCommandService({
    runtime: live,
    repositoryPolicy: persistence,
    canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
    taskReader: { getTask: () => Effect.dieMessage("unexpected task read") },
    tasks: {
      agentSessionsList: () => Effect.dieMessage("unexpected task session read"),
      agentSessionUpsert: () => Effect.dieMessage("unexpected task session write"),
      agentSessionUpdateModel: () => Effect.dieMessage("unexpected task model write"),
      transitionTask: () => Effect.dieMessage("unexpected task transition"),
    },
    taskLifecycle: { acquireLifecycle: () => Effect.dieMessage("unexpected task lifecycle") },
    taskSessionStart: {
      prepare: () => Effect.dieMessage("unexpected task start"),
      complete: () => Effect.dieMessage("unexpected task completion"),
    },
    persistTaskModel: () => Effect.dieMessage("unexpected task model write"),
  });
  const emitEffect = (event: AgentSessionTranscriptEvent) =>
    registration.runMutation(
      Effect.succeed({ value: undefined, changes: [{ type: "transcript_event", event }] }),
    );
  const emit = (event: AgentSessionTranscriptEvent) => Effect.runPromise(emitEffect(event));
  const send = (text: string) =>
    Effect.runPromise(
      commands.sendUserMessage({
        ...ref,
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text }],
      }),
    );
  const get = () => Effect.runPromise(store.get(storeRef));
  const config = repoConfigSchema.parse({
    workspaceId: "fairnest",
    workspaceName: "Fairnest",
    repoPath: database.repoPath,
  });
  const workspaceService = () =>
    createWorkspaceSessionService({
      operationGate,
      sessionTitleGate,
      store,
      settings: {
        getRepoConfig: () => Effect.succeed(config),
        listCustomAgentRoles: () => Effect.succeed([]),
      },
      runtime: { runtimeEnsure: () => Effect.dieMessage("unexpected runtime ensure") },
      live: { ...live, ...commands },
      git: createGitPortTestDouble({ canonicalizePath: (value) => Effect.succeed(value) }),
      settingsConfig: createSettingsConfigTestDouble({}),
      worktreeFiles: createWorktreeFilePortTestDouble({}),
      systemCommands: {
        resolveCommandPath: () => Effect.dieMessage("unused"),
        versionCommand: () => Effect.dieMessage("unused"),
        runCommandAllowFailure: () => Effect.dieMessage("unused"),
      },
    });
  return {
    operationGate,
    sessionTitleGate,
    ref,
    storeRef,
    record,
    store,
    live: { ...live, ...commands },
    persistence,
    updates,
    events,
    inputs,
    activityTimes,
    models,
    titleAttempts,
    renameFailures,
    state,
    accepted,
    emit,
    send,
    get,
    workspaceService,
  };
};
