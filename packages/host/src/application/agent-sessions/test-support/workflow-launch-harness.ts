import { buildAgentSystemPrompt, mergePromptOverrides } from "@openducktor/core";
import { commandPreparationFixture } from "./command-preparation-fixture";
import { createAgentMessageDeliveryService } from "../agent-message-delivery-service";
import { createTaskSessionOperations } from "../task-session-operations";
import { createWorktreeActionRunner } from "../../actions/worktree-action-runner";
import { createRuntimeRegistryPort } from "../../tasks/test-support/task-workflow-harness";
import { createTestRuntimeAdmissionGate } from "../../../test-support/runtime-admission-test-gate";
import { agentSessionRefKey } from "@openducktor/core";
import {
  type AgentSessionControlSendInput,
  type AgentSessionModelSelection,
  type AgentSessionRecord,
  type AgentSessionLiveSnapshot,
  type AgentRole,
  type RuntimeKind,
  type WorkflowLaunchRequest,
  RUNTIME_DESCRIPTORS_BY_KIND,
  GITHUB_PROVIDER_DESCRIPTOR,
  repositoryGitProviderContextSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  taskCardSchema,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { collectTaskStatusChanges } from "../../../ports/task-status-changes";
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
import { createAgentSessionCommandService } from "../agent-session-command-service";
import { createAgentSessionLiveStateService } from "../agent-session-live-state-service";
import { createLiveSessionAdapterRegistry } from "../../../adapters/agent-sessions/live-session-adapter-registry";
import { createWorkflowLaunchService } from "../workflow-launch-service";
import type { AutomaticWorkflowLaunchRequest } from "../workflow-launch-types";

/** An automatic request whose start check the harness adds. */
export type AutomaticLaunchInput = Omit<AutomaticWorkflowLaunchRequest, "policy"> & {
  policy: Omit<AutomaticWorkflowLaunchRequest["policy"], "startCheck">;
};
import type { AgentSessionSendOptions } from "../../../ports/agent-session-live-adapter-port";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
  AgentSessionBusyError,
} from "../../../ports/agent-session-send-error";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";

const unexpected = (operation: string) => () =>
  Effect.die(new Error(`Unexpected ${operation} in the workflow launch harness.`));

export const createLaunchHarness = async (
  runtimeKind: RuntimeKind = "codex",
  gates: {
    holdRelease?: Effect.Effect<void>;
    /** Pauses before the worktree preparation starts. */
    beforePrepare?: Effect.Effect<void>;
    beforeMessageOperation?: Effect.Effect<void>;
    beforeMessagePreparation?: Effect.Effect<void>;
    beforeSendContext?: Effect.Effect<void>;
    keepAttachedOnStop?: boolean;
    forkSourceRead?: Effect.Effect<void>;
    nativeStart?: Effect.Effect<void>;
    nativeFork?: Effect.Effect<void>;
    beforeModelUpdate?: Effect.Effect<void>;
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
  let providerFailure = false;
  const sendEntered = await Effect.runPromise(Deferred.make<void>());
  const records: AgentSessionRecord[] = [];
  const live = new Map<string, AgentSessionLiveSnapshot>();
  const starts: string[] = [],
    forks: string[] = [],
    resumes: string[] = [],
    stops: string[] = [];
  const sends: AgentSessionControlSendInput[] = [];
  const sendOptions: Array<AgentSessionSendOptions | undefined> = [];
  const publications: string[] = [];
  const removedWorktrees: string[] = [];
  const deletedBranches: string[] = [];
  const envelopes: unknown[] = [];
  let catalogLoads = 0;
  let sendFailure: "rejected" | "uncertain" | "accepted" | null = null;
  let publishFailure = false;
  let saveFailure = false;
  let worktreeExists = true;
  let sendGate: Effect.Effect<void> = Effect.void;
  // The native fake asks a blocking question after each accepted message.
  let questionAfterSend = true;
  let storeGate: Effect.Effect<void> = Effect.void;
  let publicationGate: Effect.Effect<void> = Effect.void;
  const liveSnapshot = (
    repoPath: string,
    workingDirectory: string,
    externalSessionId: string,
    title: string,
  ): AgentSessionLiveSnapshot => ({
    ref: { repoPath, runtimeKind, workingDirectory, externalSessionId },
    activity: "idle",
    title,
    startedAt: timestamp,
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
  });
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeId: "runtime", runtimeKind },
    {
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
          const session = liveSnapshot(
            input.repoPath,
            input.workingDirectory,
            externalSessionId,
            "Native",
          );
          live.set(agentSessionRefKey(session.ref), session);
          return {
            externalSessionId,
            runtimeKind,
            workingDirectory: input.workingDirectory,
            startedAt: timestamp,
            status: "idle" as const,
          };
        }).pipe(
          Effect.flatMap((summary) => (gates.nativeStart ?? Effect.void).pipe(Effect.as(summary))),
        ),
      forkSession: (input) =>
        Effect.sync(() => {
          const externalSessionId = `fork-${forks.length + 1}`;
          forks.push(input.parentExternalSessionId);
          const session = liveSnapshot(
            input.repoPath,
            input.workingDirectory,
            externalSessionId,
            "Child",
          );
          live.set(agentSessionRefKey(session.ref), session);
          return {
            externalSessionId,
            runtimeKind,
            workingDirectory: input.workingDirectory,
            startedAt: timestamp,
            status: "idle" as const,
          };
        }).pipe(
          Effect.flatMap((summary) => (gates.nativeFork ?? Effect.void).pipe(Effect.as(summary))),
        ),
      resumeSession: (input) =>
        Effect.sync(() => {
          resumes.push(input.externalSessionId);
          const session = liveSnapshot(
            input.repoPath,
            input.workingDirectory,
            input.externalSessionId,
            "Resumed",
          );
          live.set(agentSessionRefKey(session.ref), session);
          return {
            externalSessionId: input.externalSessionId,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            startedAt: timestamp,
            status: "idle" as const,
          };
        }),
      updateSessionModel: (input) =>
        Effect.gen(function* () {
          yield* gates.beforeModelUpdate ?? Effect.void;
          input.workStartGuard?.assertCurrent();
          input.onWorkIssued?.();
          const session = live.get(agentSessionRefKey(input));
          if (session)
            live.set(agentSessionRefKey(input), {
              ...session,
              model: input.model ? { ...input.model, runtimeKind } : undefined,
            });
          input.onWorkAccepted?.();
        }),
      sendUserMessage: (input, options) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => options?.assertCurrent?.(),
            catch: (cause) =>
              cause instanceof HostValidationError ? cause : failure(String(cause)),
          });
          sends.push(input);
          sendOptions.push(options);
          if (live.get(agentSessionRefKey(input))?.activity === "running")
            return yield* new AgentSessionBusyError({
              message: "The session is still working.",
              cause: new Error("Native turn is active"),
            });
          options?.onSent?.();
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
              operation: "native",
              message: "The model is not available.",
            });
          if (sendFailure === "uncertain") return yield* failure("Native connection lost");
          const current = live.get(agentSessionRefKey(input));
          if (current && questionAfterSend)
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
        Effect.sync(() => {
          stops.push(ref.externalSessionId);
          const session = live.get(agentSessionRefKey(ref));
          if (session && gates.keepAttachedOnStop) {
            session.activity = "idle";
            session.pendingQuestions = [];
          } else live.delete(agentSessionRefKey(ref));
        }),
      releaseSession: () => Effect.void,
    },
  );
  const runtimeAdmission = createTestRuntimeAdmissionGate();
  runtimeAdmission.open(runtimeKind);
  const background: Effect.Effect<void>[] = [];
  const messageDelivery = createAgentMessageDeliveryService({
    submissionFingerprint: JSON.stringify,
    canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
    prepare: (content) =>
      (gates.beforeMessagePreparation ?? Effect.void).pipe(
        Effect.andThen(commands.prepareUserMessage(content)),
      ),
    runOperation: (target, work, submissionId) =>
      (gates.beforeMessageOperation ?? Effect.void).pipe(
        Effect.andThen(commands.runMessageOperation(target, work, submissionId)),
      ),
    commitQueueResume: (commit) => commands.commitQueueResume(commit),
    prepareQueueResume: (content) => commands.prepareQueueResume(content),
    send: (input, options) => commands.sendUserMessage(input, options),
    steeringAvailability: () => Effect.succeed({ available: true }),
    publish: (event) => envelopes.push(event),
    runInBackground: (effect) => background.push(effect),
    now: () => timestamp,
  });
  const runtime = createAgentSessionLiveStateService({
    messageQueues: messageDelivery,
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
        Effect.sync(() => {
          const index = records.findIndex(
            (record) => record.externalSessionId === input.identity.externalSessionId,
          );
          if (index < 0) return false;
          records[index] = { ...records[index]!, selectedModel: input.selectedModel };
          return true;
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
      runStatusMutation: (_path, _operation, mutation, afterCommit) =>
        collectTaskStatusChanges(mutation).pipe(Effect.flatMap(afterCommit)),
      publishExternalTaskCreated: () => Effect.void,
      syncRepoPullRequests: () =>
        Effect.succeed({
          ran: false,
          changedTaskIds: [],
          reason: "not_configured",
          message: "Configure a Git provider.",
        }),
      publishTasksUpdated: (_repoPath, _changes, operation) =>
        publicationGate.pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (publishFailure) return Effect.fail(failure("Ownership publication failed"));
              publications.push(operation);
              return Effect.succeed({
                epoch: "11111111-1111-4111-8111-111111111111",
                sequence: publications.length,
              });
            }),
          ),
        ),
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
  // The first instruction uses the same workflow send policy as a composer message.
  const commands = createAgentSessionCommandService({
    turnPreparation: {
      ...commandPreparationFixture,
      context: (target) =>
        Effect.gen(function* () {
          yield* gates.beforeSendContext ?? Effect.void;
          return buildAgentSystemPrompt({
            role: target.sessionScope.kind === "workflow" ? target.sessionScope.role : "build",
            task: {
              taskId: task.id,
              title: task.title,
              issueType: task.issueType,
              status: task.status,
              qaRequired: task.aiReviewEnabled,
              description: task.description,
            },
            overrides: mergePromptOverrides({
              globalOverrides: settings.globalPromptOverrides,
              repoOverrides: config.promptOverrides,
            }),
          });
        }),
    },
    readSessionRootRefs: (repoPath) =>
      tasks.agentSessionsList({ repoPath, taskId: "task" }).pipe(
        Effect.map((records) =>
          records.map((record) => ({
            repoPath,
            ...record,
            sessionScope: { kind: "workflow" as const, taskId: "task", role: record.role },
          })),
        ),
        Effect.mapError(
          (cause) =>
            new HostOperationError({ operation: "test.read-roots", message: cause.message }),
        ),
      ),
    approvalPolicy: { reply: runtime.replyApproval },
    canonicalizeRepoPath: git.canonicalizePath,
    runtime,
    tasks,
    taskReader,
    taskLifecycle: lifecycle,
    taskSessionStart: preparation,
    persistTaskModel: (input) =>
      tasks.agentSessionUpdateModel(input).pipe(
        Effect.map((updated) => ({ updated, publish: Effect.void })),
        Effect.mapError(
          (cause) =>
            new HostOperationError({ operation: "test.persist-model", message: cause.message }),
        ),
      ),
    pauseForStop: messageDelivery.pauseForStop,
    repositoryPolicy: {
      run: unexpected("repository operation"),
      runSend: unexpected("repository send"),
      prepareResume: unexpected("repository resume"),
      prepareForkSource: () => Effect.die(new Error("unexpected fork source read")),
      prepareSend: unexpected("repository send"),
      recordAcceptedMessage: unexpected("repository message record"),
      prepareModelUpdate: unexpected("repository model update"),
      validateRef: unexpected("repository validation"),
    },
  });
  const service = createWorkflowLaunchService({
    messageDelivery,
    resolveParts: (parts) => Effect.succeed(parts),
    settings: workspaceSettings,
    startPreparation: preparation,
    tasks,
    taskReader,
    git,
    definitions: { listRuntimeDefinitions: () => [descriptor] },
    registry,
    queries: {
      loadRuntimeCatalog: () =>
        Effect.sync(() => {
          catalogLoads += 1;
          return {
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
                    aliases: ["model-alias"],
                    variants: ["medium", "high"],
                    speedLevels: [{ id: "fast", label: "Fast" }],
                    supportsReasoning: true,
                  },
                ],
                defaultModelsByProvider: {},
              },
            },
          };
        }),
    },
    provider: {
      getContext: () =>
        providerFailure ? Effect.fail(failure("Provider read failed")) : Effect.succeed(provider),
    },
    worktrees: {
      getTaskWorktree: () =>
        Effect.succeed(worktreeExists ? { workingDirectory: "/worktrees/task" } : null),
    },
    runtime: {
      ...runtime,
      sendUserMessage: commands.sendUserMessage,
      updateSessionModel: commands.updateSessionModel,
      holdWorkflowLaunch: (ref, held) =>
        (held ? (gates.startingHold ?? Effect.void) : (gates.holdRelease ?? Effect.void)).pipe(
          Effect.andThen(runtime.holdWorkflowLaunch(ref, held)),
        ),
    },
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
          (gates.beforePrepare ?? Effect.void).pipe(Effect.andThen(preparation.prepare(input))),
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
    /** Starts an automatic launch whose start check always passes. */
    launchAutomatic: (request: AutomaticLaunchInput) =>
      service.launch({
        ...request,
        policy: { ...request.policy, startCheck: Effect.succeed({ start: true as const }) },
      }),
    commands,
    messageDelivery,
    runBackground: async () => {
      while (background.length > 0) await Effect.runPromise(background.shift()!);
    },
    sendEntered,
    lifecycle,
    enablePullRequests: (enabled = true) => {
      provider = repositoryGitProviderContextSchema.parse({
        descriptor: GITHUB_PROVIDER_DESCRIPTOR,
        config: {
          id: "github",
          enabled,
          autoDetected: false,
          repository: { host: "github.com", owner: "example", name: "repo" },
        },
        health: enabled
          ? {
              providerId: "github",
              enabled: true,
              available: true,
              executablePath: "gh",
              version: "gh version 2.95",
              authenticated: true,
              account: "example",
              repositoryMappingValid: true,
            }
          : {
              providerId: "github",
              enabled: false,
              available: false,
              executablePath: null,
              version: null,
              authenticated: false,
              account: null,
              repositoryMappingValid: null,
              reason: "GitHub provider is not enabled for this repository.",
            },
      });
    },
    /** Adds a session that the task owns. A live session also gets a runtime snapshot. */
    addTaskSession: (
      externalSessionId: string,
      options: {
        role?: AgentRole;
        selectedModel?: AgentSessionModelSelection;
        live?: boolean;
        working?: boolean;
        pendingQuestion?: { blocking: boolean };
      } = {},
    ) => {
      const workingDirectory = "/worktrees/task";
      records.push({
        externalSessionId,
        runtimeKind,
        workingDirectory,
        role: options.role ?? "build",
        startedAt: timestamp,
        selectedModel: options.selectedModel ?? modelFor(runtimeKind),
      });
      if (options.live) {
        const snapshot = liveSnapshot("/repo", workingDirectory, externalSessionId, "Existing");
        if (options.working) snapshot.activity = "running";
        if (options.pendingQuestion)
          snapshot.pendingQuestions = [
            { requestId: "open-question", questions: [], ...options.pendingQuestion },
          ];
        live.set(agentSessionRefKey(snapshot.ref), snapshot);
      }
      return { externalSessionId, runtimeKind, workingDirectory };
    },
    runtime,
    records,
    runtimeAdmission,
    live,
    starts,
    forks,
    resumes,
    stops,
    sends,
    sendOptions,
    publications,
    removedWorktrees,
    deletedBranches,
    envelopes,
    settings,
    config,
    catalogLoads: () => catalogLoads,
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
    setProviderFailure: () => {
      providerFailure = true;
    },
    setSaveFailure: () => {
      saveFailure = true;
    },
    setWorktreeExists: (value: boolean) => {
      worktreeExists = value;
    },
    setSendGate: (value: typeof sendGate) => {
      sendGate = value;
    },
    setQuestionAfterSend: (value: boolean) => {
      questionAfterSend = value;
    },
    setStoreGate: (value: typeof storeGate) => {
      storeGate = value;
    },
    setPublicationGate: (value: typeof publicationGate) => {
      publicationGate = value;
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
export const requestFor = (runtimeKind: RuntimeKind): WorkflowLaunchRequest => ({
  workspaceId: "workspace",
  repoPath: "/repo",
  taskId: "task",
  policy: {
    kind: "manual",
    actionId: "build_implementation_start",
    decision: { startMode: "fresh", selectedModel: modelFor(runtimeKind) },
  },
  instruction: { kind: "kickoff", text: "\n  first instruction\n" },
});
export const failure = (message: string) =>
  new HostOperationError({ operation: "native", message });
