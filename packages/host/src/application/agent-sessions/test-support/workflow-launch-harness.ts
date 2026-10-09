import { createTaskSessionOperations } from "../task-session-operations";
import { createWorktreeActionRunner } from "../../actions/worktree-action-runner";
import { createRuntimeRegistryPort } from "../../tasks/test-support/task-workflow-harness";
import { createTestRuntimeAdmissionGate } from "../../../test-support/runtime-admission-test-gate";
import { agentSessionRefKey, initialSpeedState } from "@openducktor/core";
import { createAgentSessionCommandService } from "../agent-session-command-service";
import { unexpectedRuntimeQueries } from "../../../test-support/runtime-query-test-doubles";
import {
  type AgentSessionControlSendInput,
  type AgentSessionControlStartInput,
  type AgentSessionControlForkInput,
  type AgentSessionRecord,
  type AgentSessionLiveSnapshot,
  type RuntimeKind,
  type WorkflowLaunchRequest,
  type WorkflowLaunchSnapshot,
  RUNTIME_DESCRIPTORS_BY_KIND,
  GITHUB_PROVIDER_DESCRIPTOR,
  repositoryGitProviderContextSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  taskCardSchema,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../../test-support/task-store-test-double";
import { createTaskServiceWithMutationProgressTestDouble } from "../../../test-support/task-service-test-double";
import { createEventPublishingTaskService } from "../../tasks/event-publishing-task-service";
import { createTaskSessionStartPreparationService } from "../../tasks/worktrees/task-session-start-preparation-service";
import { createTaskSessionLifecycleCoordinator } from "../../tasks/worktrees/task-session-lifecycle-coordinator";
import { createAgentSessionLiveStateService } from "../agent-session-live-state-service";
import { createLiveSessionAdapterRegistry } from "../../../adapters/agent-sessions/live-session-adapter-registry";
import { createWorkflowLaunchService } from "../workflow-launch-service";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../../ports/agent-session-send-error";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../../effect/host-errors";

export const createLaunchHarness = async (
  runtimeKind: RuntimeKind = "codex",
  gates: {
    preparingPublication?: Effect.Effect<void>;
    catalog?: Effect.Effect<void>;
    holdRelease?: Effect.Effect<void>;
    admissionRelease?: Effect.Effect<void>;
    finalObservation?: Effect.Effect<void>;
    finalPublication?: Effect.Effect<void, HostOperationError>;
    canceledPublication?: Effect.Effect<void, HostOperationError>;
    preparedStart?: Effect.Effect<void>;
    forkSourceRead?: Effect.Effect<void>;
    nativeStart?: Effect.Effect<void>;
    nativeFork?: Effect.Effect<void>;
    startingHold?: Effect.Effect<void>;
    completion?: Effect.Effect<void, HostOperationError>;
  } = {},
) => {
  let task = taskCardSchema.parse({
    id: "task",
    title: "Task",
    description: "Task context",
    status: "ready_for_dev",
    issueType: "task",
    priority: 2,
    aiReviewEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  let config = repoConfigSchema.parse({
    workspaceId: "workspace",
    workspaceName: "Workspace",
    repoPath: "/repo",
    defaultModel: modelFor(runtimeKind),
    worktreeBasePath: "/worktrees",
  });
  const settings = settingsSnapshotSchema.parse({ theme: "system" });
  let provider: import("@openducktor/contracts").RepositoryGitProviderContext = null;
  const sendEntered = await Effect.runPromise(Deferred.make<void>());
  const records: AgentSessionRecord[] = [];
  const live = new Map<string, AgentSessionLiveSnapshot>();
  const starts: string[] = [],
    forks: string[] = [],
    resumes: string[] = [],
    stops: string[] = [];
  const sends: Array<AgentSessionControlSendInput & { speed?: string | null }> = [];
  const startInputs: AgentSessionControlStartInput[] = [];
  const forkInputs: AgentSessionControlForkInput[] = [];
  const snapshots: WorkflowLaunchSnapshot[] = [];
  const removedWorktrees: string[] = [];
  const deletedBranches: string[] = [];
  const envelopes: unknown[] = [];
  let sendFailure: "rejected" | "unknown" | "accepted" | null = null;
  let publishFailure = false;
  let saveFailure = false;
  let stopFailure: "rejected" | "stopped" | null = null;
  let worktreeExists = true;
  let sendGate: Effect.Effect<void> = Effect.void;
  let storeGate: Effect.Effect<void> = Effect.void;
  const queries = {
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      (gates.catalog ?? Effect.void).pipe(
        Effect.as({
          models: {
            status: "available" as const,
            catalog: {
              models: [
                {
                  id: "provider/model",
                  providerId: "provider",
                  providerName: "Provider",
                  modelId: "model",
                  modelName: "Model",
                  variants: ["medium"],
                  supportsReasoning: true,
                  speedLevels: [
                    { id: "standard", label: "Standard" },
                    { id: "fast", label: "Fast" },
                  ],
                },
              ],
              defaultModelsByProvider: {},
            },
          },
        }),
      ),
  };
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeId: "runtime", runtimeKind },
    {
      queries,
      holdSessionTurns: () => Effect.succeed(Effect.void),
      setSessionSpeedState: (ref, speed) =>
        Effect.sync(() => {
          const current = live.get(agentSessionRefKey(ref));
          if (current) live.set(agentSessionRefKey(ref), { ...current, speed });
        }),
      updateSessionSpeed: (input) => Effect.succeed({ reportedChoice: input.speed }),
      listSnapshots: () => Effect.succeed([...live.values()]),
      readSnapshot: (ref) =>
        Effect.succeed(
          live.has(agentSessionRefKey(ref))
            ? { type: "live", session: live.get(agentSessionRefKey(ref))! }
            : { type: "missing", ref },
        ),
      startSession: (input) =>
        Effect.sync(() => {
          const externalSessionId = `session-${starts.length + 1}`;
          starts.push(externalSessionId);
          startInputs.push(input);
          const session: AgentSessionLiveSnapshot = {
            ref: {
              repoPath: input.repoPath,
              runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId,
            },
            activity: "idle",
            title: "Native",
            model: input.model,
            speed: initialSpeedState(input.speed ?? "standard", "confirmed"),
            startedAt: timestamp,
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          };
          live.set(agentSessionRefKey(session.ref), session);
          return {
            externalSessionId,
            runtimeKind,
            workingDirectory: input.workingDirectory,
            startedAt: timestamp,
            status: "idle" as const,
            speed: session.speed,
          };
        }).pipe(
          Effect.flatMap((summary) => (gates.nativeStart ?? Effect.void).pipe(Effect.as(summary))),
        ),
      forkSession: (input) =>
        Effect.sync(() => {
          const externalSessionId = `fork-${forks.length + 1}`;
          forks.push(input.parentExternalSessionId);
          forkInputs.push(input);
          const session: AgentSessionLiveSnapshot = {
            ref: {
              repoPath: input.repoPath,
              runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId,
            },
            activity: "idle",
            title: "Child",
            model: input.model,
            speed: initialSpeedState(input.speed ?? "standard", "confirmed"),
            startedAt: timestamp,
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          };
          live.set(agentSessionRefKey(session.ref), session);
          return {
            externalSessionId,
            runtimeKind,
            workingDirectory: input.workingDirectory,
            startedAt: timestamp,
            status: "idle" as const,
            speed: session.speed,
          };
        }).pipe(
          Effect.flatMap((summary) => (gates.nativeFork ?? Effect.void).pipe(Effect.as(summary))),
        ),
      resumeSession: (input) =>
        Effect.sync(() => {
          resumes.push(input.externalSessionId);
          const speed = initialSpeedState(
            input.speed ?? null,
            input.speed === null ? "unapplied" : "confirmed",
          );
          live.set(agentSessionRefKey(input), {
            ref: {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
            },
            activity: "idle",
            title: "Resumed",
            model: input.model,
            speed,
            startedAt: timestamp,
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          });
          return { ...input, speed, startedAt: timestamp, status: "idle" as const };
        }),
      sendUserMessage: (input) =>
        Effect.gen(function* () {
          sends.push(input);
          yield* Deferred.succeed(sendEntered, undefined);
          yield* sendGate;
          const accepted = {
            type: "user_message" as const,
            externalSessionId: input.externalSessionId,
            messageId: `message-${sends.length}`,
            message: "Native admitted",
            parts: [{ kind: "text" as const, text: "Native admitted" }],
            timestamp,
            state: "read" as const,
          };
          if (sendFailure === "rejected")
            return yield* new AgentSessionMessageRejectedError({
              operation: "native.send",
              message: "Exact rejection",
            });
          if (sendFailure === "unknown") return yield* failure("Native connection lost");
          const current = live.get(agentSessionRefKey(input));
          if (current)
            live.set(agentSessionRefKey(input), {
              ...current,
              activity: "waiting_for_question",
              pendingQuestions: [{ requestId: "question", questions: [] }],
            });
          if (sendFailure === "accepted")
            return yield* new AgentSessionMessageAcceptedError(
              { sessionRef: input, acceptedMessage: accepted, stage: "live_update" },
              failure("Exact publication failure"),
            );
          return accepted;
        }),
      stopSession: (ref) =>
        Effect.gen(function* () {
          stops.push(ref.externalSessionId);
          if (stopFailure === "rejected") return yield* failure("Exact stop failure");
          live.delete(agentSessionRefKey(ref));
          if (stopFailure === "stopped") return yield* failure("Exact stop failure");
        }),
      releaseSession: () => Effect.void,
    },
  );
  const runtimeAdmission = createTestRuntimeAdmissionGate();
  runtimeAdmission.open(runtimeKind);
  const runtime = createAgentSessionLiveStateService({
    adapterRegistry: createLiveSessionAdapterRegistry(),
    runtimeAdmission,
    publish: (event) => envelopes.push(event),
    faultLog: () => Effect.void,
  });
  await Effect.runPromise(runtime.registerRuntimeAdapter(adapter));
  const taskReader = createTaskStoreTestDouble({
    getTask: (input) =>
      input.taskId === task.id
        ? Effect.succeed(task)
        : Effect.fail(new HostValidationError({ message: "Task not found" })),
  });
  const tasks = createEventPublishingTaskService({
    taskService: createTaskServiceWithMutationProgressTestDouble({
      agentSessionsList: () => Effect.succeed([...records]),
      agentSessionUpsert: (input) =>
        storeGate.pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (saveFailure) return Effect.fail(failure("Ownership save failed"));
              const index = records.findIndex(
                (record) => record.externalSessionId === input.session.externalSessionId,
              );
              if (index >= 0) records[index] = input.session;
              else records.push(input.session);
              return Effect.succeed(true);
            }),
          ),
        ),
      agentSessionUpdateModel: (input) =>
        Effect.suspend(() => {
          if (saveFailure) return Effect.fail(failure("Settings save failed"));
          const index = records.findIndex(
            (record) =>
              record.externalSessionId === input.identity.externalSessionId &&
              record.runtimeKind === input.identity.runtimeKind &&
              record.workingDirectory === input.identity.workingDirectory,
          );
          if (index < 0) return Effect.succeed(false);
          records[index] = {
            ...records[index]!,
            selectedModel: input.selectedModel,
            speed: input.speed === undefined ? records[index]!.speed : input.speed,
          };
          return Effect.succeed(true);
        }),
      transitionTask: (input) =>
        Effect.sync(() => {
          task = { ...task, status: input.status };
          return task;
        }),
      humanRequestChanges: () =>
        Effect.sync(() => {
          task = { ...task, status: "in_progress" };
          return task;
        }),
      updateTask: (input) =>
        Effect.sync(() => {
          task = taskCardSchema.parse({ ...task, ...input.patch });
          return task;
        }),
    }),
    taskSyncService: {
      runMutation: (_path, mutation) => mutation,
      publishExternalTaskCreated: () => Effect.void,
      syncRepoPullRequests: () => Effect.succeed({ ran: false, changedTaskIds: [] }),
      publishTasksUpdated: () =>
        publishFailure ? Effect.fail(failure("Ownership publication failed")) : Effect.void,
    },
  });
  const workspaceSettings = createWorkspaceSettingsServiceTestDouble({
    getRepoConfig: (id) =>
      id === config.workspaceId
        ? Effect.succeed(config)
        : Effect.fail(new HostValidationError({ message: "Unknown workspace" })),
    getRepoConfigByRepoPath: () => Effect.succeed(config),
    getSettingsSnapshot: () => Effect.succeed(settings),
  });
  const git = createGitPortTestDouble({
    canonicalizePath: (path) => Effect.succeed(path),
    isGitRepository: () => Effect.succeed(true),
    isRegisteredWorktree: () => Effect.succeed(true),
    shareGitCommonDirectory: () => Effect.succeed(true),
    getCurrentBranch: () => Effect.succeed({ name: "odt/task-task", detached: false }),
    referenceExists: () => Effect.succeed(true),
    createWorktree: () =>
      Effect.sync(() => {
        worktreeExists = true;
      }),
    configureBranchUpstream: () => Effect.succeed({ createdTrackingRef: null }),
    removeWorktree: (_repoPath, path) =>
      Effect.sync(() => {
        removedWorktrees.push(path);
        worktreeExists = false;
      }),
    deleteLocalBranch: (_repoPath, branch) =>
      Effect.sync(() => {
        deletedBranches.push(branch);
      }),
  });
  const settingsConfig = createSettingsConfigTestDouble({
    join: (...parts) => parts.join("/"),
    defaultWorktreeBasePath: () => "/worktrees",
    resolveConfiguredPath: (path) => path,
    pathExists: (path) => Effect.sync(() => (path === "/worktrees/task" ? worktreeExists : true)),
  });
  const lifecycle = createTaskSessionLifecycleCoordinator();
  const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind];
  const registry = createRuntimeRegistryPort({
    requireReady: () =>
      Effect.succeed({
        runtimeId: "runtime",
        kind: runtimeKind,
        descriptor,
        startedAt: timestamp,
        runtimeRoute: { type: "local_http" as const, endpoint: "http://localhost:1234" },
      }),
  });
  const preparation = createTaskSessionStartPreparationService({
    taskStore: taskReader,
    gitPort: git,
    settingsConfig,
    workspaceSettingsService: workspaceSettings,
    runtimeRegistry: registry,
    runtimeDefinitionsService: { listRuntimeDefinitions: () => [descriptor] },
    taskSessionLifecycleCoordinator: lifecycle,
    worktreeFiles: createWorktreeFilePortTestDouble({
      ensureDirectory: () => Effect.void,
      copyConfiguredPaths: () => Effect.void,
      resolveWorktreePath: (_repoPath, path) => path,
      pathIsWithinRoot: (root, path) => Effect.succeed(root === path),
      resolvePathWithinRoot: (_root, path) =>
        Effect.succeed({
          canonicalPath: path,
          cleanupPath: path,
          kind: "descendant",
          isSymlink: false,
        }),
      removePathIfPresent: () => Effect.void,
    }),
    worktreeActions: createWorktreeActionRunner({
      startCommandInPreparedTarget: () => Effect.die(new Error("unexpected worktree action")),
      close: () => Effect.die(new Error("unexpected terminal close")),
      readOutputTail: () => Effect.die(new Error("unexpected terminal output")),
    }),
  });
  const commands = createAgentSessionCommandService({
    canonicalizeRepoPath: git.canonicalizePath,
    runtime,
    tasks,
    taskReader,
    taskLifecycle: lifecycle,
    taskSessionStart: preparation,
    persistTaskModel: (input) =>
      tasks.agentSessionUpdateModelDeferredPublication(input).pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "task-session.persist-settings")),
        Effect.map(({ updated, publish }) => ({
          updated,
          publish: publish.pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, "task-session.publish-settings"),
            ),
          ),
        })),
      ),
    repositoryPolicy: {
      run: (_ref, _operation, effect) => effect,
      runSend: (_ref, effect) => effect,
      validateRef: () => Effect.void,
      prepareResume: (input) => Effect.succeed({ input, save: () => Effect.void }),
      prepareSend: (input) => Effect.succeed(input),
      recordAcceptedMessage: () => Effect.void,
      prepareSpeedUpdate: () => Effect.die(new Error("Unexpected repository speed update")),
      prepareModelUpdate: () => Effect.die(new Error("Unexpected repository model update")),
    },
  });
  const service = createWorkflowLaunchService({
    resolveParts: (parts) => Effect.succeed(parts),
    settings: workspaceSettings,
    startPreparation: preparation,
    tasks,
    taskReader,
    git,
    definitions: { listRuntimeDefinitions: () => [descriptor] },
    registry,
    queries,
    provider: { getContext: () => Effect.succeed(provider) },
    worktrees: {
      getTaskWorktree: () =>
        Effect.succeed(worktreeExists ? { workingDirectory: "/worktrees/task" } : null),
    },
    runtime: {
      ...runtime,
      sendUserMessage: commands.sendUserMessage,
      resumeSession: commands.resumeSession,
      updateSessionSpeed: commands.updateSessionSpeed,
      read: (ref) =>
        (gates.finalObservation ?? Effect.void).pipe(Effect.andThen(runtime.read(ref))),
      holdWorkflowLaunch: (ref, held) =>
        (held ? (gates.startingHold ?? Effect.void) : (gates.holdRelease ?? Effect.void)).pipe(
          Effect.andThen(runtime.holdWorkflowLaunch(ref, held)),
        ),
    },
    lifecycle,
    withProcessStartAdmission: (_path, work) =>
      work.pipe(Effect.ensuring(gates.admissionRelease ?? Effect.void)),
    publish: (value) =>
      (value.phase === "completed"
        ? (gates.finalPublication ?? Effect.void)
        : value.phase === "canceled"
          ? (gates.canceledPublication ?? Effect.void)
          : value.phase === "preparing"
            ? (gates.preparingPublication ?? Effect.void)
            : Effect.void
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            snapshots.push(value);
          }),
        ),
      ),
    sessions: createTaskSessionOperations({
      canonicalizeRepoPath: git.canonicalizePath,
      runtime,
      tasks: {
        ...tasks,
        agentSessionsList: (input) =>
          (gates.forkSourceRead ?? Effect.void).pipe(
            Effect.andThen(tasks.agentSessionsList(input)),
          ),
      },
      taskReader,
      taskLifecycle: lifecycle,
      taskSessionStart: {
        ...preparation,
        prepare: (input) =>
          preparation
            .prepare(input)
            .pipe(
              Effect.flatMap((prepared) =>
                (gates.preparedStart ?? Effect.void).pipe(Effect.as(prepared)),
              ),
            ),
      },
      writes: {
        saveSession: tasks.agentSessionUpsertDeferredPublication,
        transitionTask: (input) =>
          (gates.completion ?? Effect.void).pipe(
            Effect.andThen(tasks.transitionTaskDeferredPublication(input)),
          ),
      },
    }),
  });
  return {
    service,
    adapter,
    queries,
    sendEntered,
    lifecycle,
    enablePullRequests: () => {
      provider = repositoryGitProviderContextSchema.parse({
        descriptor: GITHUB_PROVIDER_DESCRIPTOR,
        config: {
          id: "github",
          enabled: true,
          autoDetected: false,
          repository: { host: "github.com", owner: "example", name: "repo" },
        },
        health: {
          providerId: "github",
          enabled: true,
          available: true,
          executablePath: "gh",
          version: "gh version 2.95",
          authenticated: true,
          account: "example",
          repositoryMappingValid: true,
        },
      });
    },
    runtime,
    commands,
    records,
    runtimeAdmission,
    live,
    starts,
    startInputs,
    forkInputs,
    forks,
    resumes,
    stops,
    sends,
    snapshots,
    removedWorktrees,
    deletedBranches,
    envelopes,
    settings,
    config,
    getTask: () => task,
    setTaskType: (issueType: typeof task.issueType) => {
      task = { ...task, issueType };
    },
    setTaskStatus: (status: typeof task.status) => {
      task = { ...task, status };
    },
    setModelDefault: (value: typeof config.defaultModel) => {
      config = { ...config, defaultModel: value };
    },
    setSendFailure: (value: typeof sendFailure) => {
      sendFailure = value;
    },
    setPublishFailure: () => {
      publishFailure = true;
    },
    setSaveFailure: () => {
      saveFailure = true;
    },
    setStopFailure: (value: NonNullable<typeof stopFailure>) => {
      stopFailure = value;
    },
    setWorktreeExists: (value: boolean) => {
      worktreeExists = value;
    },
    setSendGate: (value: typeof sendGate) => {
      sendGate = value;
    },
    setStoreGate: (value: typeof storeGate) => {
      storeGate = value;
    },
  };
};

export const timestamp = "2026-10-03T12:00:00.000Z";
export const modelFor = (runtimeKind: RuntimeKind) => ({
  runtimeKind,
  providerId: "provider",
  modelId: "model",
  variant: "medium",
});
export const requestFor = (
  runtimeKind: RuntimeKind,
  launchAttemptId = "attempt",
): WorkflowLaunchRequest => ({
  launchAttemptId,
  workspaceId: "workspace",
  repoPath: "/repo",
  taskId: "task",
  policy: {
    kind: "manual",
    actionId: "build_implementation_start",
    decision: { startMode: "fresh", selectedModel: modelFor(runtimeKind) },
  },
  instruction: { kind: "kickoff", text: "\n  retained instruction\n" },
});
export const failure = (message: string) =>
  new HostOperationError({ operation: "native", message });
