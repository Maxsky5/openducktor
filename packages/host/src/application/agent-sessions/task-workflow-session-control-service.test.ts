import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import {
  agentModelCatalogSchema,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { initialSpeedState, SessionTurnAdmission } from "@openducktor/core";
import { describe, expect, mock, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionControlUpdateModelInput,
  AgentSessionRecord,
  AgentWorkflowSessionStartInput,
  TaskCard,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createBuildWorktreeActions,
  createRuntimeDefinitionsService,
  task as harnessTask,
} from "../tasks/test-support/task-workflow-harness";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import { createAgentSessionCommandService as createControlService } from "./agent-session-command-service";
import type { TaskSessionModelPersistence } from "./task-workflow-session-policy";
import { holdSessionSettings } from "./agent-session-settings-admission";
import type { ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk";
import {
  createClaudeSession,
  createClaudeQueryFixture,
} from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "../../adapters/claude/claude-agent-sdk-session-store";
import { observeClaudeSpeed } from "../../adapters/claude/claude-session-speed-observation";
import { ClaudeSessionSpeedControl } from "../../adapters/claude/claude-session-speed-control";
import { updateClaudeSessionModel } from "../../adapters/claude/claude-session-model-update";
import { createClaudeSessionSettingsControls } from "../../adapters/agent-sessions/claude-session-settings-controls";
import { createClaudeLiveSessionState } from "../../adapters/agent-sessions/claude-live-session-state";
import { toClaudeModelDescriptor } from "../../adapters/claude/claude-agent-sdk-catalog";

type ControlServiceInput = Parameters<typeof createControlService>[0];
type TestControlServiceInput = Omit<
  ControlServiceInput,
  "taskSessionStart" | "tasks" | "repositoryPolicy" | "persistTaskModel" | "runtime"
> & {
  runtime: Omit<
    ControlServiceInput["runtime"],
    "loadContext" | "loadSessionDiff" | "replyApproval" | "replyQuestion"
  >;
  taskSessionStart?: ControlServiceInput["taskSessionStart"];
  persistTaskModel?: TaskSessionModelPersistence;
  tasks: Omit<ControlServiceInput["tasks"], "transitionTask"> &
    Partial<Pick<ControlServiceInput["tasks"], "transitionTask">>;
};

const createAgentSessionCommandService = (input: TestControlServiceInput) =>
  createControlService({
    taskSessionStart: {
      prepare: () => Effect.die(new Error("unexpected task session preparation")),
      complete: () => Effect.die(new Error("unexpected task session completion")),
    },
    persistTaskModel: () => Effect.die(new Error("unexpected stored model update")),
    ...input,
    runtime: {
      loadContext: () => Effect.die(new Error("unexpected context read")),
      loadSessionDiff: () => Effect.die(new Error("unexpected diff read")),
      replyApproval: () => Effect.die(new Error("unexpected approval reply")),
      replyQuestion: () => Effect.die(new Error("unexpected question reply")),
      ...input.runtime,
    },
    repositoryPolicy: {
      run: (_ref, _operation, effect) => effect,
      runSend: (_ref, effect) => effect,
      validateRef: () => Effect.void,
      prepareResume: (request) => Effect.succeed({ input: request, save: () => Effect.void }),
      prepareSend: (request) => Effect.succeed(request),
      recordAcceptedMessage: () => Effect.void,
      prepareSpeedUpdate: () => Effect.die(new Error("Unexpected speed preparation")),
      prepareModelUpdate: (request) =>
        Effect.succeed({
          input: request,
          previousModel: null,
          previousSpeed: "standard",
          save: () => Effect.succeed(Effect.void),
        }),
    },
    tasks: {
      transitionTask: () => Effect.die(new Error("unexpected task transition")),
      ...input.tasks,
    },
  });

const workflowStart: AgentWorkflowSessionStartInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  targetWorkingDirectory: "/repo/worktree",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  systemPrompt: "Build the feature",
  model: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
};

const summary: Omit<AgentSessionControlSummary, "speed"> = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  title: "Build session",
  startedAt: "2026-09-02T10:00:00.000Z",
  status: "idle",
};

const storedModel: AgentSessionRecord["selectedModel"] = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  profileId: "build",
};

const task = (status: TaskCard["status"]): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status,
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: {
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    },
    planner: {
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    },
    builder: {
      required: true,
      canSkip: false,
      available: false,
      completed: false,
    },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-09-02T10:00:00.000Z",
  createdAt: "2026-09-02T09:00:00.000Z",
});

const taskReader = { getTask: () => Effect.succeed(task("in_progress")) };

const createControlDeps = () => ({
  canonicalizeRepoPath: (repoPath: string) => Effect.succeed(repoPath),
  taskReader,
  taskLifecycle: createTaskSessionLifecycleCoordinator(),
});

const workflowModelUpdate: AgentSessionControlUpdateModelInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: workflowStart.sessionScope,
  model: { providerId: "openai", modelId: "gpt-5.1" },
};

const workflowSend: AgentSessionControlSendInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: workflowStart.sessionScope,
  parts: [{ kind: "text", text: "Continue" }],
  model: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    profileId: "other-profile",
  },
};

const acceptedUserMessage: AcceptedAgentUserMessage = {
  type: "user_message",
  externalSessionId: "session-1",
  timestamp: "2026-09-02T10:01:00.000Z",
  messageId: "message-1",
  message: "Continue",
  parts: [{ kind: "text", text: "Continue" }],
  state: "queued",
};

const unexpectedSend = () => Effect.die(new Error("unexpected send"));

type ControlDeps = Parameters<typeof createAgentSessionCommandService>[0];

const createModelUpdateService = ({
  selectedModel = storedModel,
  runtimeKind = "opencode",
  updateRuntimeModel,
  persistTaskModel,
}: {
  selectedModel?: AgentSessionRecord["selectedModel"];
  runtimeKind?: AgentSessionRecord["runtimeKind"];
  updateRuntimeModel: ControlDeps["runtime"]["updateSessionModel"];
  persistTaskModel: TaskSessionModelPersistence;
}) =>
  createAgentSessionCommandService({
    ...createControlDeps(),
    runtime: {
      withSessionSettings: (_input, operation) =>
        operation(
          createAgentSessionRuntimeAdapterTestDouble(
            { runtimeId: "runtime-1", runtimeKind: "codex" },
            {
              readSnapshot: (ref) => Effect.succeed({ type: "missing" as const, ref }),
              setSessionSpeedState: () => Effect.void,
              updateSessionModel: updateRuntimeModel,
              updateSessionSpeed: () => Effect.succeed({ reportedChoice: "standard" }),
              queries: {
                ...unexpectedRuntimeQueries,
                loadRuntimeCatalog: () =>
                  Effect.succeed({
                    models: {
                      status: "available" as const,
                      catalog: {
                        runtime: CODEX_RUNTIME_DESCRIPTOR,
                        models: [
                          {
                            id: "gpt-5.6-sol",
                            providerId: "openai",
                            providerName: "Codex",
                            modelId: "gpt-5.6-sol",
                            modelName: "GPT",
                            variants: [],
                            speedLevels: [{ id: "standard", label: "Standard" }],
                          },
                        ],
                        defaultModelsByProvider: {},
                      },
                    },
                  }),
              },
            },
          ),
        ),
      startSession: () => Effect.die(new Error("unexpected start")),
      resumeSession: () => Effect.die(new Error("unexpected resume")),
      continueInterruptedTurn: () => Effect.die(new Error("unexpected continue interrupted turn")),
      forkSession: () => Effect.die(new Error("unexpected fork")),
      sendUserMessage: unexpectedSend,
      updateSessionModel: updateRuntimeModel,
      stopSession: () => Effect.die(new Error("unexpected stop")),
      releaseSession: () => Effect.die(new Error("unexpected release")),
    },
    tasks: {
      agentSessionsList: () =>
        Effect.succeed([{ ...summary, runtimeKind, role: "build", selectedModel }]),
      agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
    },
    persistTaskModel,
  });

describe("createAgentSessionCommandService", () => {
  test.each([true, false])(
    "keeps the known model when task speed recovery retries a failed save (live model: %s)",
    async (hasLiveModel) => {
      const nativeModel = { providerId: "openai", modelId: "gpt-5.6-sol", variant: "high" };
      let record: AgentSessionRecord = {
        ...summary,
        runtimeKind: "codex",
        role: "build",
        selectedModel: { ...storedModel, runtimeKind: "codex" },
        speed: "standard",
      };
      const previousModel = record.selectedModel;
      const admission = new SessionTurnAdmission();
      admission.setBlocked(true);
      let speed = initialSpeedState(null, "uncertain");
      let failSave = true;
      const published: AgentSessionRecord[] = [];
      const sends: AgentSessionControlSendInput[] = [];
      const adapter = createAgentSessionRuntimeAdapterTestDouble(
        { runtimeId: "runtime-1", runtimeKind: "codex" },
        {
          holdSessionTurns: () =>
            Effect.promise(() => admission.hold()).pipe(
              Effect.map((release) => Effect.sync(release)),
            ),
          readSnapshot: (ref) =>
            Effect.sync(() => ({
              type: "live" as const,
              session: {
                ref,
                activity: "idle" as const,
                title: "Build session",
                startedAt: summary.startedAt,
                pendingApprovals: [],
                pendingQuestions: [],
                contextUsage: null,
                model: hasLiveModel ? nativeModel : undefined,
                speed,
              },
            })),
          setSessionSpeedState: (_ref, next) =>
            Effect.sync(() => {
              speed = next;
              admission.setBlocked(next.synchronization !== "confirmed" || next.choice === null);
            }),
          updateSessionSpeed: (input) => Effect.succeed({ reportedChoice: input.speed }),
        },
      );
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          withSessionSettings: (input, operation) => holdSessionSettings(adapter, input, operation),
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () => Effect.die(new Error("unexpected continuation")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: (input) =>
            Effect.promise(() =>
              admission.run(async () => {
                sends.push(input);
                return acceptedUserMessage;
              }),
            ),
          updateSessionModel: () => Effect.die(new Error("unexpected model change")),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () => Effect.sync(() => [record]),
          agentSessionUpsert: () => Effect.die(new Error("unexpected upsert")),
        },
        persistTaskModel: (input) =>
          Effect.gen(function* () {
            if (failSave)
              return yield* new HostOperationError({
                operation: "test.store",
                message: "store failed",
              });
            record = { ...record, selectedModel: input.selectedModel, speed: input.speed };
            return {
              updated: true,
              publish: Effect.sync(() => {
                published.push(record);
              }),
            };
          }),
      });
      const input = {
        repoPath: "/repo",
        runtimeKind: "codex" as const,
        externalSessionId: "session-1",
        workingDirectory: "/repo/worktree",
        sessionScope: workflowStart.sessionScope,
        speed: "standard",
      };
      await expect(Effect.runPromise(service.updateSessionSpeed(input))).rejects.toThrow(
        "store failed",
      );
      expect(record.selectedModel).toEqual(previousModel);
      expect(published).toEqual([]);
      expect(speed.synchronization).toBe("uncertain");
      await expect(admission.run(async () => "new turn")).rejects.toThrow();

      failSave = false;
      await Effect.runPromise(service.updateSessionSpeed(input));
      const expectedModel = hasLiveModel
        ? { ...nativeModel, runtimeKind: "codex" as const, profileId: "build" }
        : previousModel;
      expect(record.selectedModel).toEqual(expectedModel);
      expect(published).toEqual([expect.objectContaining({ selectedModel: expectedModel })]);
      expect(speed).toMatchObject({ choice: "standard", synchronization: "confirmed" });
      await Effect.runPromise(service.sendUserMessage({ ...workflowSend, runtimeKind: "codex" }));
      expect(sends).toEqual([expect.objectContaining({ model: expectedModel, speed: "standard" })]);
    },
  );

  test.each([
    { modelChanged: true, savedChoice: "standard", nativeChoice: "standard", failure: null },
    { modelChanged: true, savedChoice: "fast", nativeChoice: "standard", failure: "save" },
    { modelChanged: true, savedChoice: "standard", nativeChoice: "fast", failure: "save" },
    { modelChanged: true, savedChoice: "fast", nativeChoice: "standard", failure: "restore" },
    { modelChanged: true, savedChoice: "standard", nativeChoice: null, failure: "save" },
  ] as const)(
    "a cold speed change keeps attached settings: %j",
    async ({ modelChanged, savedChoice, nativeChoice, failure }) => {
      const model = {
        runtimeKind: "claude" as const,
        providerId: "claude",
        modelId: "opus",
        variant: "low",
        profileId: "build",
      };
      const attachedModel = modelChanged
        ? { ...model, modelId: "claude-opus-5-5", variant: "high" }
        : model;
      let record: AgentSessionRecord = {
        ...summary,
        runtimeKind: "claude",
        role: "build",
        selectedModel: model,
        speed: savedChoice,
      };
      const store = createClaudeAgentSdkSessionStore();
      const state = createClaudeLiveSessionState((ref) => store.get(ref.externalSessionId)?.model);
      let nativeFast: boolean | undefined =
        nativeChoice === null ? undefined : nativeChoice === "fast";
      const flags = mock(async ({ fastMode }: Parameters<Query["applyFlagSettings"]>[0]) => {
        if (failure === "restore" && fastMode === false) throw new Error("restore failed");
        if (fastMode !== undefined) nativeFast = fastMode ?? undefined;
      });
      const control = new ClaudeSessionSpeedControl({
        findSession: (id) => store.get(id),
        requireSession: (id) => {
          const session = store.get(id);
          if (!session) throw new Error("Session not attached");
          return session;
        },
        createSession: (input, runtimeId) =>
          Effect.sync(() => {
            const session = createClaudeSession({
              input,
              runtimeId,
              model: attachedModel,
              summary: {
                ...createClaudeSession().summary,
                speed: initialSpeedState(
                  nativeChoice,
                  nativeChoice === null ? "unapplied" : "confirmed",
                ),
              },
              query: createClaudeQueryFixture({
                supportedModels: async () => [
                  {
                    value: "opus",
                    resolvedModel: "claude-opus-5-5",
                    displayName: "Opus",
                    description: "Opus",
                    supportsFastMode: true,
                  },
                ],
                applyFlagSettings: flags,
              }),
            });
            store.set(session);
            const report: Parameters<typeof observeClaudeSpeed>[1] = {
              fast_mode_state: nativeChoice === "fast" ? "on" : "off",
            };
            if (nativeChoice === null) report.fast_mode_disabled_reason = "network_error";
            const observation = observeClaudeSpeed(session, report, false);
            state.applyEvent(session, {
              type: "session_speed_changed",
              externalSessionId: session.externalSessionId,
              timestamp: session.startedAt,
              observation,
            });
            record = { ...record, selectedModel: attachedModel, speed: nativeChoice };
            return session.summary;
          }),
        now: () => "2026-10-09T00:00:00Z",
        emit: () => {},
        onBackgroundFailure: () => Effect.void,
      });
      const adapter = createAgentSessionRuntimeAdapterTestDouble(
        { runtimeId: "runtime-1", runtimeKind: "claude" },
        {
          ...createClaudeSessionSettingsControls({
            service: {
              holdSessionTurns: control.holdSessionTurns.bind(control),
              setSessionSpeedState: control.setSessionSpeedState.bind(control),
              updateSessionSpeed: control.updateSessionSpeed.bind(control),
              updateSessionModel: () => Effect.die(new Error("unexpected model change")),
            },
            runtimeId: "runtime-1",
            state,
            sessionError: (operation) => (cause) =>
              new HostOperationError({
                operation,
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
            commit: (_operation, mutation) => Effect.sync(() => mutation().value),
            runControlMutation: (effect) => effect,
          }),
          readSnapshot: (ref) => Effect.sync(() => state.readSnapshot(ref)),
        },
      );
      const save = mock<TaskSessionModelPersistence>((input) =>
        Effect.gen(function* () {
          if (failure)
            return yield* new HostOperationError({
              operation: "test.store",
              message: "store failed",
            });
          record = {
            ...record,
            selectedModel: input.selectedModel,
            speed: input.speed,
          };
          return { updated: true, publish: Effect.void };
        }),
      );
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          withSessionSettings: (input, operation) => holdSessionSettings(adapter, input, operation),
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () => Effect.die(new Error("unexpected continuation")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model change")),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () => Effect.sync(() => [record]),
          agentSessionUpsert: () => Effect.die(new Error("unexpected upsert")),
        },
        persistTaskModel: save,
      });
      const requested = nativeChoice === "standard" ? "fast" : "standard";
      const result = await Effect.runPromise(
        Effect.result(
          service.updateSessionSpeed({
            repoPath: "/repo",
            workingDirectory: "/repo/worktree",
            externalSessionId: "session-1",
            runtimeKind: "claude",
            sessionScope: workflowStart.sessionScope,
            speed: requested,
          }),
        ),
      );
      const session = store.get("session-1")!;
      if (failure) {
        const uncertain = failure === "restore" || nativeChoice === null;
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            message: uncertain ? expect.stringContaining("could not be confirmed") : "store failed",
          },
        });
        expect(record.speed).toBe(nativeChoice);
        expect(session.summary.speed).toMatchObject({
          choice: nativeChoice,
          synchronization: uncertain ? "uncertain" : "confirmed",
        });
        expect(nativeFast).toBe(uncertain ? requested === "fast" : nativeChoice === "fast");
        if (uncertain)
          await expect(session.turnAdmission.run(async () => "admitted")).rejects.toThrow();
        else expect(await session.turnAdmission.run(async () => "admitted")).toBe("admitted");
      } else {
        expect(result).toMatchObject({
          _tag: "Success",
          success: { choice: requested, synchronization: "confirmed" },
        });
        expect(nativeFast).toBe(requested === "fast");
        expect(record.speed).toBe(requested);
      }
      expect(flags).toHaveBeenCalledWith({ fastMode: requested === "fast" });
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ speed: requested, selectedModel: attachedModel }),
      );
      expect(record.selectedModel).toEqual(attachedModel);
      store.close(session);
    },
  );
  test.each([
    ...[
      { modelId: "opus-2", variant: "high", processing: "standard", saveFails: false },
      { modelId: "opus", variant: "low", processing: "standard", saveFails: false },
      { modelId: "opus-2", variant: "high", processing: "cooldown", saveFails: false },
      { modelId: "opus", variant: "low", processing: "cooldown", saveFails: false },
      { modelId: "opus-2", variant: "high", processing: "standard", saveFails: true },
      { modelId: "opus", variant: "low", processing: "standard", saveFails: true },
      { modelId: "sonnet", variant: "high", processing: "standard", saveFails: false },
      { modelId: "sonnet", variant: "high", processing: "standard", saveFails: true },
    ].map((path) => ({
      ...path,
      cold: false,
      nativeChoice: "fast",
      modelChanged: false,
      applyFails: false,
    })),
    ...[
      { modelId: "opus-2", nativeChoice: "standard", saveFails: false },
      { modelId: "opus-2", nativeChoice: "fast", saveFails: false },
      { modelId: "opus-2", nativeChoice: null, saveFails: false },
      { modelId: "sonnet", nativeChoice: "fast", saveFails: false },
      { modelId: "opus-2", nativeChoice: "fast", saveFails: true },
      { modelId: "sonnet", nativeChoice: "fast", saveFails: true },
    ].map((path) => ({
      ...path,
      cold: true,
      variant: "high",
      processing: "cooldown",
      modelChanged: false,
      applyFails: false,
    })),
    ...[
      { saveFails: true, applyFails: false },
      { saveFails: false, applyFails: true },
    ].map((path) => ({
      ...path,
      cold: true,
      modelChanged: true,
      modelId: "opus-2",
      variant: "low",
      processing: "cooldown",
      nativeChoice: "fast",
    })),
  ])(
    "keeps Claude speed through $modelId/$variant (cold: $cold, choice: $nativeChoice, save fails: $saveFails)",
    async ({
      modelId,
      variant,
      processing,
      saveFails,
      cold,
      nativeChoice,
      modelChanged,
      applyFails,
    }) => {
      const originalModel = {
        providerId: "claude",
        modelId: "opus",
        profileId: "build",
        variant: "high",
      };
      const attachedModel = modelChanged
        ? { ...originalModel, modelId: "opus-2", variant: "medium" }
        : originalModel;
      const nextModel = { ...originalModel, modelId, variant };
      const unsupported = modelId === "sonnet";
      const nativeModels = ["opus", "opus-2", "sonnet"].map((value) => {
        const model: ModelInfo = { value, displayName: value, description: value };
        if (value !== "sonnet") model.supportsFastMode = true;
        return model;
      });
      const catalog = agentModelCatalogSchema.parse({
        runtime: CLAUDE_RUNTIME_DESCRIPTOR,
        models: nativeModels.map((model) => ({
          ...toClaudeModelDescriptor(model),
          variants: ["high", "low"],
        })),
        defaultModelsByProvider: {},
      });
      let nativeEffort = attachedModel.variant;
      let nativeModel = attachedModel.modelId;
      const flags = mock(async (settings: Parameters<Query["applyFlagSettings"]>[0]) => {
        if (applyFails && settings.effortLevel === "low") throw new Error("apply failed");
        if (settings.effortLevel !== undefined) nativeEffort = settings.effortLevel ?? "";
      });
      const session = createClaudeSession({
        input: {
          repoPath: "/repo",
          workingDirectory: "/repo/worktree",
          runtimeKind: "claude",
          runtimePolicy: { kind: "claude" },
          sessionScope: workflowStart.sessionScope,
          systemPrompt: "Build",
          model: originalModel,
        },
        model: attachedModel,
        summary: {
          ...createClaudeSession().summary,
          speed: initialSpeedState(nativeChoice, nativeChoice === null ? "unapplied" : "confirmed"),
        },
        query: createClaudeQueryFixture({
          supportedModels: async () => nativeModels,
          applyFlagSettings: flags,
          setModel: async (model) => {
            nativeModel = model ?? "";
          },
        }),
      });
      let report: Parameters<typeof observeClaudeSpeed>[1] = { fast_mode_state: "cooldown" };
      if (processing === "standard")
        report = { fast_mode_state: "off", fast_mode_disabled_reason: "extra_usage_disabled" };
      if (nativeChoice === "standard") report = { fast_mode_state: "off" };
      observeClaudeSpeed(session, report, false);
      const previous = session.summary.speed;
      const restoreFails = unsupported && previous.availability.status === "blocked";
      const sessionStore = createClaudeAgentSdkSessionStore();
      let record: AgentSessionRecord = {
        ...summary,
        runtimeKind: "claude",
        role: "build",
        selectedModel: { ...originalModel, runtimeKind: "claude" },
        speed: cold ? null : "fast",
      };
      const state = createClaudeLiveSessionState(
        (ref) => sessionStore.get(ref.externalSessionId)?.model,
      );
      const attach = () => {
        sessionStore.set(session);
        record = {
          ...record,
          selectedModel: { ...attachedModel, runtimeKind: "claude" },
          speed: nativeChoice,
        };
        state.applyControlSummary("/repo", {
          ...session.summary,
          workingDirectory: "/repo/worktree",
          speed: previous,
        });
        return session.summary;
      };
      if (!cold) attach();
      const control = new ClaudeSessionSpeedControl({
        findSession: (id) => sessionStore.get(id),
        requireSession: () => session,
        createSession: () =>
          cold ? Effect.sync(attach) : Effect.die(new Error("unexpected attach")),
        now: () => "2026-10-08T00:00:00Z",
        emit: () => {},
        onBackgroundFailure: () => Effect.void,
      });
      const adapter = createAgentSessionRuntimeAdapterTestDouble(
        { runtimeId: session.runtimeId, runtimeKind: "claude" },
        {
          ...createClaudeSessionSettingsControls({
            service: {
              holdSessionTurns: control.holdSessionTurns.bind(control),
              setSessionSpeedState: control.setSessionSpeedState.bind(control),
              updateSessionSpeed: control.updateSessionSpeed.bind(control),
              updateSessionModel: (input) =>
                updateClaudeSessionModel(input, {
                  sessionStore,
                  attach: () => Effect.die(new Error("unexpected attach")),
                }),
            },
            runtimeId: session.runtimeId,
            state,
            sessionError: (operation) => (cause) =>
              new HostOperationError({
                operation,
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
            commit: (_operation, mutation) => Effect.sync(() => mutation().value),
            runControlMutation: (effect) => effect,
          }),
          readSnapshot: (ref) => Effect.sync(() => state.readSnapshot(ref)),
          queries: {
            ...unexpectedRuntimeQueries,
            loadRuntimeCatalog: () =>
              Effect.succeed({ models: { status: "available" as const, catalog } }),
          },
        },
      );
      const saves: unknown[] = [];
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          withSessionSettings: (input, operation) => holdSessionSettings(adapter, input, operation),
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () => Effect.die(new Error("unexpected continuation")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected direct model update")),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () => Effect.sync(() => [record]),
          agentSessionUpsert: () => Effect.die(new Error("unexpected upsert")),
        },
        persistTaskModel: (input) =>
          Effect.gen(function* () {
            expect(session.turnAdmission?.isClosed).toBe(true);
            expect(session.summary.speed.synchronization).toBe("pending");
            if (saveFails)
              return yield* new HostOperationError({
                operation: "test.store",
                message: "store failed",
              });
            saves.push(input);
            record = { ...record, selectedModel: input.selectedModel, speed: input.speed };
            return { updated: true, publish: Effect.void };
          }),
      });
      const result = await Effect.runPromise(
        Effect.result(
          service.updateSessionModel({
            ...workflowModelUpdate,
            runtimeKind: "claude",
            model: nextModel,
          }),
        ),
      );
      if (saveFails || applyFails) {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            message: restoreFails
              ? expect.stringContaining("could not be confirmed")
              : applyFails
                ? "apply failed"
                : "store failed",
          },
        });
        expect(saves).toEqual([]);
        expect(session.model).toEqual(attachedModel);
        expect(nativeModel).toBe(attachedModel.modelId);
        expect(nativeEffort).toBe(attachedModel.variant);
        expect(record.selectedModel).toEqual({ ...attachedModel, runtimeKind: "claude" });
        expect(record.speed).toBe(nativeChoice);
      } else {
        expect(result._tag).toBe("Success");
        expect(saves).toEqual([
          expect.objectContaining({
            speed: unsupported ? "standard" : nativeChoice,
            selectedModel: { ...nextModel, runtimeKind: "claude" },
          }),
        ]);
        expect(session.model).toEqual(nextModel);
      }
      if (unsupported) {
        const expectedFlags = [{ fastMode: false }];
        if (saveFails && !restoreFails) expectedFlags.push({ fastMode: true });
        expect(flags.mock.calls.map(([settings]) => settings)).toEqual(expectedFlags);
        let expectedProcessing = { status: "off" };
        if (saveFails)
          expectedProcessing = restoreFails ? previous.processing : { status: "unknown" };
        expect(session.summary.speed).toMatchObject({
          choice: saveFails ? "fast" : "standard",
          synchronization: saveFails && restoreFails ? "uncertain" : "confirmed",
          processing: expectedProcessing,
        });
        if (saveFails && restoreFails)
          await expect(session.turnAdmission!.run(async () => "admitted")).rejects.toThrow();
        else expect(await session.turnAdmission!.run(async () => "admitted")).toBe("admitted");
      } else {
        expect(session.summary.speed).toEqual(previous);
        if (nativeChoice === null)
          await expect(session.turnAdmission!.run(async () => "admitted")).rejects.toThrow(
            "pending",
          );
        else expect(await session.turnAdmission!.run(async () => "admitted")).toBe("admitted");
        expect(flags.mock.calls.filter(([settings]) => "fastMode" in settings)).toEqual(
          nativeChoice === "standard" ? [[{ fastMode: false }]] : [],
        );
      }
      expect(state.readSnapshot({ ...workflowModelUpdate, runtimeKind: "claude" })).toMatchObject({
        type: "live",
        session: { speed: session.summary.speed },
      });
      sessionStore.close(session);
    },
  );

  test.each([
    { nativeChoice: "standard", saveFails: false },
    { nativeChoice: "fast", saveFails: false },
    { nativeChoice: null, saveFails: false },
    { nativeChoice: "standard", saveFails: true },
  ])(
    "confirms an imported choice before interrupted work: %j",
    async ({ nativeChoice, saveFails }) => {
      const entered = Promise.withResolvers<void>();
      const commit = Promise.withResolvers<void>();
      const admission = new SessionTurnAdmission();
      let state = initialSpeedState(nativeChoice, "confirmed");
      let durable: string | null = null;
      const continued: unknown[] = [];
      const selectedModel = { ...storedModel, runtimeKind: "codex" as const };
      const adapter = createAgentSessionRuntimeAdapterTestDouble(
        { runtimeId: "runtime-1", runtimeKind: "codex" },
        {
          holdSessionTurns: () =>
            Effect.promise(() => admission.hold()).pipe(
              Effect.map((release) => Effect.sync(release)),
            ),
          readSnapshot: (ref) =>
            Effect.succeed({
              type: "live" as const,
              session: {
                ref,
                activity: "idle" as const,
                title: "Build session",
                startedAt: summary.startedAt,
                pendingApprovals: [],
                pendingQuestions: [],
                contextUsage: null,
                speed: state,
              },
            }),
          setSessionSpeedState: (_ref, next) =>
            Effect.sync(() => {
              state = next;
              admission.setBlocked(next.synchronization !== "confirmed" || next.choice === null);
            }),
          queries: {
            ...unexpectedRuntimeQueries,
            loadRuntimeCatalog: () =>
              Effect.succeed({
                models: {
                  status: "available" as const,
                  catalog: {
                    runtime: CODEX_RUNTIME_DESCRIPTOR,
                    models: [
                      {
                        id: "gpt-5",
                        providerId: "openai",
                        providerName: "OpenAI",
                        modelId: "gpt-5",
                        modelName: "GPT",
                        variants: [],
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
          },
        },
      );
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          withSessionSettings: (input, operation) => holdSessionSettings(adapter, input, operation),
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected reattach")),
          continueInterruptedTurn: (input) =>
            Effect.sync(() => {
              expect(durable).toBe(nativeChoice);
              expect(admission.isClosed).toBe(false);
              continued.push(input);
              return { ...summary, runtimeKind: "codex" as const, speed: state };
            }),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () =>
            Effect.succeed([
              {
                ...summary,
                runtimeKind: "codex" as const,
                role: "build" as const,
                selectedModel,
                speed: durable,
              },
            ]),
          agentSessionUpsert: () => Effect.die(new Error("unexpected session upsert")),
        },
        persistTaskModel: ({ speed }) =>
          Effect.gen(function* () {
            entered.resolve();
            yield* Effect.promise(() => commit.promise);
            if (saveFails)
              return yield* new HostOperationError({
                operation: "test.store",
                message: "store failed",
              });
            durable = speed ?? null;
            return { updated: true, publish: Effect.void };
          }),
      });
      const pending = Effect.runPromise(
        Effect.result(
          service.resumeSession({
            repoPath: "/repo",
            runtimeKind: "codex",
            workingDirectory: "/repo/worktree",
            externalSessionId: "session-1",
            sessionScope: workflowStart.sessionScope,
            resumeMode: "continue_interrupted_turn",
          }),
        ),
      );
      if (nativeChoice !== null) {
        await entered.promise;
        expect(continued).toHaveLength(0);
        await expect(admission.run(async () => "new turn")).rejects.toThrow("pending");
        commit.resolve();
      }
      const result = await pending;
      if (nativeChoice === null || saveFails) {
        expect(result._tag).toBe("Failure");
        expect(continued).toHaveLength(0);
        expect(durable).toBeNull();
      } else {
        expect(result._tag).toBe("Success");
        expect(continued).toEqual([
          expect.objectContaining({ speed: nativeChoice, model: selectedModel }),
        ]);
      }
    },
  );

  test("rejects workflow startup while direct merge runs", async () => {
    const deps = createControlDeps();
    const service = createAgentSessionCommandService({
      ...deps,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* deps.taskLifecycle.acquireLifecycle("/repo", ["task-1"], "direct merge");
          const result = yield* Effect.result(service.startWorkflowSession(workflowStart));
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { operation: "task.start session.lifecycle_guard" },
          });
        }),
      ),
    );
  });

  test.each([
    { step: "runtime", stopFails: false, storeFails: false },
    { step: "runtime", stopFails: true, storeFails: false },
    { step: "store", stopFails: false, storeFails: false },
    { step: "store", stopFails: true, storeFails: false },
    { step: "store", stopFails: false, storeFails: true },
  ])(
    "waits for the interrupted startup step before cleanup: %j",
    async ({ step, stopFails, storeFails }) => {
      const calls: string[] = [];
      const created = await Effect.runPromise(Deferred.make<void>());
      const returnSummary = await Effect.runPromise(Deferred.make<void>());
      const preparedTask = task("ready_for_dev");
      const deps = createControlDeps();
      const service = createAgentSessionCommandService({
        ...deps,
        taskSessionStart: {
          prepare: () =>
            Effect.succeed({
              canonicalRepoPath: "/repo",
              rollback: () =>
                Effect.sync(() => {
                  calls.push("cleanup-worktree");
                  return "";
                }),
              preparedStatus: preparedTask.status,
              role: "build",
              runtimeKind: "opencode",
              task: preparedTask,
              workingDirectory: "/repo/worktree",
            }),
          complete: () => Effect.die(new Error("unexpected completion")),
        },
        runtime: {
          withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
          startSession: () =>
            Effect.gen(function* () {
              calls.push("runtime-created");
              if (step === "runtime") {
                yield* Deferred.succeed(created, undefined);
                yield* Deferred.await(returnSummary);
              }
              calls.push("runtime-returned");
              return summary;
            }),
          stopSession: (ref) =>
            Effect.gen(function* () {
              expect(ref.externalSessionId).toBe(summary.externalSessionId);
              calls.push("stop-runtime");
              if (stopFails) {
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "test.stop",
                    message: "stop failed",
                  }),
                );
              }
            }),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () =>
            Effect.die(new Error("unexpected continue interrupted turn")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () => Effect.die(new Error("unexpected list")),
          agentSessionUpsert: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(created, undefined);
              yield* Deferred.await(returnSummary);
              if (storeFails) {
                calls.push("store-failed");
                return yield* Effect.fail(
                  new HostOperationError({ operation: "test.store", message: "store failed" }),
                );
              }
              calls.push("store-committed");
              return true;
            }),
        },
      });
      const fiber = Effect.runFork(service.startWorkflowSession(workflowStart));
      try {
        await Effect.runPromise(Deferred.await(created));
        fiber.interruptUnsafe();
        await Effect.runPromise(Deferred.succeed(returnSummary, undefined));
        expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
        const expected = ["runtime-created", "runtime-returned"];
        if (step === "store") {
          expected.push(storeFails ? "store-failed" : "store-committed");
        }
        expected.push("stop-runtime");
        if (!stopFails && (step === "runtime" || storeFails)) {
          expected.push("cleanup-worktree");
        }
        expect(calls).toEqual(expected);
        await expect(
          Effect.runPromise(
            Effect.scoped(deps.taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await Effect.runPromise(Deferred.succeed(returnSummary, undefined));
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
    },
  );

  test("starts and stores a fresh workflow session inside one task lifecycle scope", async () => {
    const calls: string[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const preparedTask = task("ready_for_dev");
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      taskLifecycle,
      taskSessionStart: {
        prepare: () =>
          Effect.sync(() => {
            calls.push("prepare");
            return {
              canonicalRepoPath: "/repo",
              rollback: () => Effect.void,
              preparedStatus: preparedTask.status,
              role: "build" as const,
              runtimeKind: "opencode" as const,
              task: preparedTask,
              workingDirectory: "/repo/worktree",
            };
          }),
        complete: (_prepared, transitionTask) =>
          Effect.gen(function* () {
            calls.push("complete");
            yield* transitionTask({
              repoPath: "/repo",
              taskId: "task-1",
              status: "in_progress",
            });
            return undefined;
          }),
      },
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () =>
          Effect.sync(() => {
            calls.push("runtime");
            return summary;
          }),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.gen(function* () {
            calls.push("store");
            const overlap = yield* Effect.result(
              Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
            );
            expect(overlap._tag).toBe("Failure");
            return true;
          }),
        transitionTask: () =>
          Effect.sync(() => {
            calls.push("transition");
            return task("in_progress");
          }),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).resolves.toEqual(summary);
    expect(calls).toEqual(["prepare", "runtime", "store", "complete", "transition"]);
    await expect(
      Effect.runPromise(
        Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
      ),
    ).resolves.toBeUndefined();
  });

  test("stops the runtime and removes a new worktree when session storage fails", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            rollback: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () => Effect.die(new Error("unexpected completion")),
      },
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.sync(() => calls.push("stop-runtime")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.fail(new HostOperationError({ operation: "test.store", message: "store failed" })),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("store failed");
    expect(calls).toEqual(["stop-runtime", "cleanup-worktree"]);
  });

  test("closes worktree action terminals before it removes a new worktree when the runtime start fails", async () => {
    const calls: unknown[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      taskLifecycle,
      taskSessionStart: createTaskSessionStartPreparationService({
        taskStore: createTaskStoreTestDouble({
          getTask: () => Effect.succeed(harnessTask({ status: "ready_for_dev" })),
        }),
        gitPort: createBuildStartGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        worktreeActions: createBuildWorktreeActions(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
        }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        taskSessionLifecycleCoordinator: taskLifecycle,
      }),
      runtime: {
        startSession: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.start", message: "runtime start failed" }),
          ),
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("runtime start failed");
    const types = calls.map(
      (call) => z.object({ type: z.string() }).safeParse(call).data?.type ?? null,
    );
    expect(types).toContain("runWorktreeActions");
    expect(types).toContain("stopWorktreeActionTerminals");
    expect(types.indexOf("stopWorktreeActionTerminals")).toBeLessThan(
      types.indexOf("removeWorktree"),
    );
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
  });

  test("keeps a new worktree when session storage and runtime stop both fail", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            rollback: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () => Effect.die(new Error("unexpected completion")),
      },
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () =>
          Effect.sync(() => calls.push("stop-runtime")).pipe(
            Effect.andThen(
              Effect.fail(
                new HostOperationError({
                  operation: "test.stop",
                  message: "runtime stop failed",
                }),
              ),
            ),
          ),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.fail(new HostOperationError({ operation: "test.store", message: "store failed" })),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("store failed Cleanup failed: runtime stop failed");
    expect(calls).toEqual(["stop-runtime"]);
  });

  test("keeps the stored session and worktree when Builder completion fails", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            rollback: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.complete", message: "task changed" }),
          ),
      },
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.sync(() => calls.push("stop-runtime")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () => Effect.succeed(true),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("task changed");
    expect(calls).toEqual(["stop-runtime"]);
  });

  test("does not store a repository session", async () => {
    let storeCount = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.sync(() => {
            storeCount += 1;
            return true;
          }),
      },
    });

    await Effect.runPromise(
      service.startSession({
        repoPath: workflowStart.repoPath,
        runtimeKind: workflowStart.runtimeKind,
        workingDirectory: "/repo/worktree",
        sessionScope: { kind: "repository" },
        systemPrompt: workflowStart.systemPrompt,
        model: workflowStart.model,
      }),
    );

    expect(storeCount).toBe(0);
  });

  test("stores controlled resume and fork results", async () => {
    const stored: AgentSessionRecord[] = [];
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: (input) =>
          Effect.succeed({
            ...summary,
            externalSessionId: input.externalSessionId,
          }),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([
            {
              ...summary,
              role: "build",
              selectedModel: storedModel,
            },
          ]),
        agentSessionUpsert: ({ session }) =>
          Effect.sync(() => {
            stored.push(session);
            return true;
          }),
      },
    });

    await Effect.runPromise(
      service.resumeSession({
        resumeMode: "reattach",
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
      }),
    );
    await Effect.runPromise(
      service.forkSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        parentExternalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        systemPrompt: "Fork it",
        model: workflowStart.model,
      }),
    );

    expect(stored.map(({ externalSessionId }) => externalSessionId)).toEqual([
      "session-1",
      "fork-1",
    ]);
    expect(stored[0]?.selectedModel).toEqual(storedModel);
  });

  test("routes a continue-interrupted-turn resume to the runtime without storing a session", async () => {
    const continuations: unknown[] = [];
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected reattach resume")),
        continueInterruptedTurn: (input) =>
          Effect.sync(() => {
            continuations.push(input);
            return { ...summary, externalSessionId: input.externalSessionId };
          }),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build" as const, selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    const result = await Effect.runPromise(
      service.resumeSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: storedModel,
        resumeMode: "continue_interrupted_turn",
      }),
    );

    expect(result).toMatchObject({ externalSessionId: "session-1" });
    expect(continuations).toHaveLength(1);
    expect(continuations[0]).toMatchObject({
      repoPath: "/repo",
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: workflowStart.sessionScope,
      model: storedModel,
    });
    expect(continuations[0]).not.toHaveProperty("resumeMode");
    expect(continuations[0]).not.toHaveProperty("selectedModel");
  });

  test("rejects a workflow resume when the stored role differs", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([
            {
              ...summary,
              role: "planner" as const,
              selectedModel: storedModel,
            },
          ]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    await expect(
      Effect.runPromise(
        service.resumeSession({
          resumeMode: "reattach",
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when the task does not own the parent", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    await expect(
      Effect.runPromise(
        service.forkSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          parentExternalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          systemPrompt: "Fork it",
          model: workflowStart.model,
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when its role is not available", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskReader: { getTask: () => Effect.succeed(task("closed")) },
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    await expect(
      Effect.runPromise(
        service.forkSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          parentExternalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          systemPrompt: "Fork it",
          model: workflowStart.model,
        }),
      ),
    ).rejects.toThrow("build workflow is not available for task task-1");
    expect(runtimeCalls).toBe(0);
  });

  test("sends a workflow message through its stored session", async () => {
    const runtimeInputs: (AgentSessionControlSendInput & { speed?: string | null })[] = [];
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: () => Effect.succeed("/repo"),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: (input) =>
          Effect.sync(() => {
            runtimeInputs.push(input);
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle: createTaskSessionLifecycleCoordinator(),
    });

    await expect(
      Effect.runPromise(service.sendUserMessage({ ...workflowSend, repoPath: "/repo/." })),
    ).resolves.toEqual(acceptedUserMessage);
    expect(runtimeInputs).toEqual([
      {
        ...workflowSend,
        speed: "standard",
        repoPath: "/repo",
        model: storedModel,
      },
    ]);
  });

  test("rejects a workflow message when the task does not own the session", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
    });

    await expect(Effect.runPromise(service.sendUserMessage(workflowSend))).rejects.toThrow(
      "Task 'task-1' does not own session 'session-1' for role 'build'.",
    );
    expect(runtimeCalls).toBe(0);
  });

  test("does not send a workflow message while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(service.sendUserMessage(workflowSend));
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("updates a stored model only after the runtime accepts the workflow change", async () => {
    const calls: string[] = [];
    const runtimeInputs: unknown[] = [];
    const storedModels: unknown[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: (input) =>
          Effect.sync(() => {
            calls.push("runtime");
            runtimeInputs.push(input);
          }),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      persistTaskModel: (input) =>
        Effect.sync(() => {
          calls.push("store");
          storedModels.push(input);
          return { updated: true, publish: Effect.void };
        }),
      taskLifecycle,
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: {
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
        },
      }),
    );

    expect(calls).toEqual(["runtime", "store"]);
    expect(runtimeInputs).toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: {
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
        },
      },
    ]);
    expect(storedModels).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        speed: "standard",
        identity: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
          profileId: "build",
        },
      },
    ]);
  });

  test("stores a model switch without an undefined profile key when no profile is stored", async () => {
    const storedModels: unknown[] = [];
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      runtimeKind: "codex",
      selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-6-astra" },
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      persistTaskModel: (input) =>
        Effect.sync(() => {
          storedModels.push(input.selectedModel);
          return { updated: true, publish: Effect.void };
        }),
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: { providerId: "openai", modelId: "gpt-5.6-sol" },
      }),
    );

    expect(runtimeModels).toEqual([{ providerId: "openai", modelId: "gpt-5.6-sol" }]);
    expect(storedModels).toStrictEqual([
      { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5.6-sol" },
    ]);
  });

  test("restores the runtime model when the task record update fails", async () => {
    const calls: string[] = [];
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          calls.push("runtime");
          runtimeModels.push(input.model);
        }),
      persistTaskModel: () => {
        calls.push("store");
        return Effect.fail(
          new HostOperationError({
            operation: "task-session.update-model",
            message: "task store unavailable",
          }),
        );
      },
    });

    await expect(
      Effect.runPromise(
        service.updateSessionModel({
          ...workflowModelUpdate,
          model: {
            providerId: "openai",
            modelId: "gpt-5.1",
            variant: "high",
          },
        }),
      ),
    ).rejects.toThrow("task store unavailable");

    expect(calls).toEqual(["runtime", "store", "runtime"]);
    expect(runtimeModels).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-5.1",
        variant: "high",
      },
      {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "build",
      },
    ]);
  });

  test("clears the runtime model when a failed task record update had no stored model", async () => {
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      selectedModel: null,
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      persistTaskModel: () =>
        Effect.fail(
          new HostOperationError({
            operation: "task-session.update-model",
            message: "task store unavailable",
          }),
        ),
    });

    await expect(
      Effect.runPromise(service.updateSessionModel(workflowModelUpdate)),
    ).rejects.toThrow("task store unavailable");

    expect(runtimeModels).toEqual([{ providerId: "openai", modelId: "gpt-5.1" }, null]);
  });

  test("restores the runtime model when no task record is updated", async () => {
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      persistTaskModel: () => Effect.succeed({ updated: false, publish: Effect.void }),
    });

    await expect(
      Effect.runPromise(service.updateSessionModel(workflowModelUpdate)),
    ).rejects.toThrow("Task 'task-1' did not update session 'session-1'.");

    expect(runtimeModels).toEqual([
      { providerId: "openai", modelId: "gpt-5.1" },
      { providerId: "openai", modelId: "gpt-5", profileId: "build" },
    ]);
  });

  test("reports both failures when it cannot restore the runtime model", async () => {
    const storeFailure = new HostOperationError({
      operation: "task-session.update-model",
      message: "task store unavailable",
    });
    const restoreFailure = new HostOperationError({
      operation: "agent-session.update-model",
      message: "runtime restore unavailable",
    });
    let runtimeCalls = 0;
    const service = createModelUpdateService({
      updateRuntimeModel: () => {
        runtimeCalls += 1;
        return runtimeCalls === 1 ? Effect.void : Effect.fail(restoreFailure);
      },
      persistTaskModel: () => Effect.fail(storeFailure),
    });

    const result = await Effect.runPromise(
      Effect.result(service.updateSessionModel(workflowModelUpdate)),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(HostOperationError);
      expect(result.failure.message).toBe(
        "task store unavailable Runtime model restore failed: runtime restore unavailable",
      );
      expect(result.failure.cause).toEqual({ storeFailure, restoreFailure });
    }
  });

  test("checks workflow ownership before it changes the runtime model", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle,
    });

    await expect(
      Effect.runPromise(
        service.updateSessionModel({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          model: { providerId: "openai", modelId: "gpt-5.1" },
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("does not change a workflow model while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
            service.updateSessionModel({
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
              model: { providerId: "openai", modelId: "gpt-5.1" },
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("does not resume a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
            service.resumeSession({
              resumeMode: "reattach",
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("does not fork a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
            service.forkSession({
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              parentExternalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
              systemPrompt: "Fork it",
              model: workflowStart.model,
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("holds the task lifecycle gate until the fork record is stored", async () => {
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    let resetWasBlocked = false;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.result,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Failure";
              }),
            ),
            Effect.as(true),
          ),
      },
      taskLifecycle,
    });

    await Effect.runPromise(
      service.forkSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        parentExternalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        systemPrompt: "Fork it",
        model: workflowStart.model,
      }),
    );

    expect(resetWasBlocked).toBe(true);
  });

  test("holds the task lifecycle gate until the model record is stored", async () => {
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    let resetWasBlocked = false;
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        withSessionSettings: () => Effect.die(new Error("Unexpected settings change")),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.result,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Failure";
              }),
            ),
            Effect.asVoid,
          ),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      },
      persistTaskModel: () => Effect.succeed({ updated: true, publish: Effect.void }),
      taskLifecycle,
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: { providerId: "openai", modelId: "gpt-5.1" },
      }),
    );

    expect(resetWasBlocked).toBe(true);
  });
});
