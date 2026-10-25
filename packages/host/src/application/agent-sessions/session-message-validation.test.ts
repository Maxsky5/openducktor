import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit } from "effect";
import {
  repoConfigSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentRuntimeCatalog,
  settingsSnapshotSchema,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshot,
  type AgentSessionModelSelection,
  type RuntimeKind,
} from "@openducktor/contracts";
import { emptyArtifactSummary } from "@openducktor/workflows";
import { createClaudeLiveSessionState } from "../../adapters/agent-sessions/claude-live-session-state";
import { handleClaudeSdkMessage } from "../../adapters/claude/claude-agent-sdk-events";
import { createClaudeSession } from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "../../adapters/claude/claude-agent-sdk-test-messages";
import { AgentSessionBusyError } from "../../ports/agent-session-send-error";
import { toAgentSessionLiveEnvelope } from "./agent-session-live-envelope";
import { createAgentSessionCommandService } from "./agent-session-command-service";
import { createSessionTurnPreparation } from "./session-turn-preparation";
import { createAgentMessageDeliveryService } from "./agent-message-delivery-service";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { taskCardFixture } from "../../test-support/task-card-fixture";

const target = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/tree",
  externalSessionId: "root",
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
};
const selection = (modelId = "current"): AgentSessionModelSelection => ({
  runtimeKind: "opencode",
  providerId: "provider",
  modelId,
  profileId: "build",
});
const attachment = {
  kind: "attachment" as const,
  attachment: {
    id: "image",
    name: "image.png",
    path: "/staged/image.png",
    kind: "image" as const,
    mime: "image/png",
  },
};

const setup = (
  runtimeKind: RuntimeKind,
  catalog?: Effect.Effect<AgentRuntimeCatalog>,
  activities: AgentSessionLiveSnapshot["activity"][] = [],
  readLiveSnapshot?: () => AgentSessionLiveSnapshot,
) => {
  const recipient = { ...target, runtimeKind };
  let savedModel = { ...selection(), runtimeKind };
  let attached = true;
  let stored = true;
  let nativeModel = savedModel;
  const order: string[] = [];
  const background: Effect.Effect<void>[] = [];
  let activity: AgentSessionLiveSnapshot["activity"] = "idle";
  let foregroundTurnActive: boolean | undefined;
  let statusUnavailableReason: string | undefined;
  const native = { sends: 0, models: 0 };
  let readCount = 0;
  const waiting = Promise.withResolvers<void>();
  const live = (): AgentSessionLiveSnapshot => {
    if (readLiveSnapshot) return { ...readLiveSnapshot(), model: savedModel };
    const snapshot: AgentSessionLiveSnapshot = {
      ref: recipient,
      title: "Session",
      startedAt: "2026-10-13T12:00:00Z",
      activity,
      model: savedModel,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    if (foregroundTurnActive !== undefined) snapshot.foregroundTurnActive = foregroundTurnActive;
    if (statusUnavailableReason !== undefined)
      snapshot.statusUnavailableReason = statusUnavailableReason;
    return snapshot;
  };
  const taskReader = {
    getTask: () =>
      Effect.succeed(
        taskCardFixture({
          artifactSummary: emptyArtifactSummary(),
          id: "task-1",
          title: "Task",
          description: "",
          status: "in_progress",
          priority: 2,
          issueType: "task",
          createdAt: "2026-10-13T12:00:00Z",
          updatedAt: "2026-10-13T12:00:00Z",
        }),
      ),
  };
  const queries = {
    loadRuntimeCatalog: () => catalog ?? Effect.die(new Error("Send must not load a catalog")),
  };
  const unexpected = () => Effect.die(new Error("Unexpected native work"));
  const commands = createAgentSessionCommandService({
    taskWorkflows: builtinTaskWorkflows,
    canonicalizeRepoPath: Effect.succeed,
    taskReader,
    taskLifecycle: createTaskSessionLifecycleCoordinator(),
    taskSessionStart: { prepare: unexpected, complete: unexpected },
    persistTaskModel: (input) =>
      Effect.sync(() => {
        savedModel = { ...input.selectedModel!, runtimeKind };
        return { updated: true, publish: Effect.void };
      }),
    pauseForStop: () => Effect.void,
    approvalPolicy: { reply: unexpected },
    readSessionRootRefs: () => Effect.succeed([recipient]),
    turnPreparation: createSessionTurnPreparation({
      taskWorkflows: builtinTaskWorkflows,
      taskReader,
      queries,
      settings: {
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigSchema.parse({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath: "/repo",
            }),
          ),
        getSettingsSnapshot: () =>
          Effect.succeed(settingsSnapshotSchema.parse({ theme: "system" })),
      },
    }),
    runtime: {
      read: () =>
        Effect.sync(() => {
          activity = activities.shift() ?? activity;
          if (++readCount === 2) waiting.resolve();
          return attached
            ? { type: "live" as const, session: live() }
            : { type: "missing" as const, ref: recipient };
        }),
      list: () => Effect.succeed([live()]),
      publishOperation: () => Effect.void,
      retainOperation: () => Effect.void,
      startSession: unexpected,
      forkSession: unexpected,
      resumeSession: unexpected,
      continueInterruptedTurn: unexpected,
      releaseSession: unexpected,
      stopSession: () =>
        Effect.sync(() => {
          activity = "idle";
          order.push("stop");
        }),
      loadContext: unexpected,
      loadSessionDiff: unexpected,
      replyApproval: unexpected,
      replyQuestion: () =>
        Effect.sync(() => {
          order.push("answer");
          activity = "running";
        }),
      updateSessionModel: (input) =>
        Effect.sync(() => {
          input.workStartGuard?.assertCurrent();
          input.onWorkIssued?.();
          native.models += 1;
          nativeModel = { ...input.model!, runtimeKind };
          order.push("settings");
          input.onWorkAccepted?.();
        }),
      sendUserMessage: (input) =>
        Effect.suspend(() => {
          const snapshot = live();
          if (
            (snapshot.foregroundTurnActive ?? snapshot.activity === "running") &&
            input.delivery !== "steer"
          )
            return Effect.fail(
              new AgentSessionBusyError({
                message: "Session is working",
                cause: new Error("Turn active"),
              }),
            );
          return Effect.sync(() => {
            native.sends += 1;
            order.push(`send:${nativeModel.modelId}`);
            return {
              type: "user_message" as const,
              externalSessionId: "root",
              messageId: "accepted",
              timestamp: "2026-10-13T12:00:00Z",
              message: "Message",
              parts: input.parts.filter((part) => part.kind !== "slash_command"),
              state: "read" as const,
              model: nativeModel,
            };
          });
        }),
    },
    tasks: {
      agentSessionsList: () =>
        Effect.succeed(
          stored
            ? [
                {
                  externalSessionId: "root",
                  runtimeKind,
                  workingDirectory: "/repo/tree",
                  role: "build",
                  selectedModel: savedModel,
                  startedAt: "2026-10-13T12:00:00Z",
                },
              ]
            : [],
        ),
      agentSessionUpsert: unexpected,
      agentSessionUpdateModel: () => Effect.succeed(true),
      applyStartEvent: unexpected,
    },
    repositoryPolicy: {
      run: (_ref, _op, work) => work,
      runSend: (_ref, work) => work,
      prepareForkSource: () => Effect.die(new Error("unexpected fork source read")),
      prepareSend: Effect.succeed,
      prepareResume: unexpected,
      prepareModelUpdate: unexpected,
      recordAcceptedMessage: unexpected,
      validateRef: unexpected,
    },
  });
  const delivery = createAgentMessageDeliveryService({
    canonicalizeRepoPath: Effect.succeed,
    submissionFingerprint: JSON.stringify,
    prepare: commands.prepareUserMessage,
    runOperation: commands.runMessageOperation,
    commitQueueResume: commands.commitQueueResume,
    prepareQueueResume: commands.prepareQueueResume,
    send: commands.sendUserMessage,
    steeringAvailability: () => Effect.succeed({ available: true }),
    publish: () => {},
    runInBackground: (effect) => background.push(effect),
    now: () => "2026-10-13T12:00:00Z",
  });
  return {
    target: recipient,
    commands,
    delivery,
    native,
    order,
    background,
    live,
    waiting: waiting.promise,
    detach: () => {
      attached = false;
    },
    removeRecord: () => {
      stored = false;
    },
    setActivity: (value: typeof activity) => {
      activity = value;
    },
    setForeground: (value: boolean) => {
      foregroundTurnActive = value;
    },
    setUnavailable: (value: string | undefined) => {
      statusUnavailableReason = value;
    },
  };
};

describe("message delivery uses prepared session settings", () => {
  test("refuses a steer after the foreground ends while background work stays running", async () => {
    const h = setup("opencode");
    h.setActivity("running");
    h.setForeground(false);
    try {
      const result = await Effect.runPromiseExit(
        h.commands.sendUserMessage({
          ...h.target,
          delivery: "steer",
          parts: [{ kind: "text", text: "Join the turn" }],
        }),
      );
      expect(result._tag).toBe("Failure");
      expect(h.native.sends).toBe(0);
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test.each(["claude", "codex", "opencode"] as const)(
    "%s sends and steers without catalog or model work",
    async (kind) => {
      const h = setup(kind);
      try {
        for (const delivery of ["new_turn", "steer"] as const) {
          const result = await Effect.runPromise(
            h.commands.sendUserMessage({ ...h.target, parts: [attachment], delivery }),
          );
          expect(result.type).toBe("user_message");
          h.setActivity("running");
        }
        expect(h.native).toEqual({ sends: 2, models: 0 });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test("editing a queued message needs no catalog and stores no model", async () => {
    const h = setup("opencode");
    h.setActivity("running");
    h.delivery.observeChanges([
      {
        type: "session_upsert",
        session: {
          ref: h.target,
          title: "Session",
          activity: "running",
          startedAt: "2026-10-13T12:00:00Z",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        },
      },
    ]);
    try {
      await Effect.runPromise(
        h.delivery.submit({
          ...h.target,
          submissionId: "queued",
          mode: "default",
          parts: [{ kind: "text", text: "Original" }],
        }),
      );
      const edited = await Effect.runPromise(
        h.delivery.manage({ ...h.target, action: { kind: "begin_edit", submissionId: "queued" } }),
      );
      const entry = edited.queue.entries[0];
      if (entry?.state !== "editing") throw new Error("Missing edit reservation");
      await Effect.runPromise(
        h.delivery.manage({
          ...h.target,
          action: {
            kind: "save_edit",
            submissionId: "queued",
            editId: entry.editId,
            parts: [attachment],
          },
        }),
      );
      const queued = h.delivery.listQueues("/repo")[0]?.entries[0];
      expect(queued).toMatchObject({ state: "queued", parts: [attachment] });
      expect(queued).not.toHaveProperty("model");
      expect(h.native).toEqual({ sends: 0, models: 0 });
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });
});

const settingsCatalog = {
  models: {
    status: "available",
    catalog: {
      runtime: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      models: ["current", "next"].map((modelId) => ({
        id: `provider/${modelId}`,
        providerId: "provider",
        providerName: "Provider",
        modelId,
        modelName: modelId,
        variants: [],
      })),
      profiles: [{ name: "build", mode: "primary" }],
      defaultModelsByProvider: { provider: "current" },
    },
  },
} satisfies AgentRuntimeCatalog;

describe("explicit settings ordering", () => {
  test("applies settings and delivers the queue after a Claude foreground turn reaches Idle", async () => {
    const nativeSession = createClaudeSession({
      externalSessionId: target.externalSessionId,
      input: {
        ...target,
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
        systemPrompt: "Build",
      },
      summary: {
        externalSessionId: target.externalSessionId,
        runtimeKind: "claude",
        workingDirectory: target.workingDirectory,
        sessionAssociation: target.sessionScope,
        startedAt: "2026-10-13T12:00:00Z",
        status: "idle",
      },
    });
    const state = createClaudeLiveSessionState();
    state.applyControlSummary(target.repoPath, nativeSession.summary);
    const claudeSettingsCatalog: AgentRuntimeCatalog = {
      models: {
        ...settingsCatalog.models,
        catalog: {
          ...settingsCatalog.models.catalog,
          runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
        },
      },
    };
    const h = setup("claude", Effect.succeed(claudeSettingsCatalog), [], () => {
      const snapshot = state.readSnapshot({ ...target, runtimeKind: "claude" });
      if (snapshot.type !== "live") throw new Error("Claude session must remain live");
      return snapshot.session;
    });
    const changes: AgentSessionLiveEnvelope[] = [];
    const send = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
      handleClaudeSdkMessage({
        session: nativeSession,
        message,
        timestamp: "2026-10-13T12:01:00Z",
        modelSelection: (modelId) => ({ runtimeKind: "claude", providerId: "provider", modelId }),
        emit: (event) =>
          changes.push(...state.applyEvent(nativeSession, event).map(toAgentSessionLiveEnvelope)),
      });
    const publish = async () => {
      const pending = changes.splice(0);
      for (const change of pending) await Effect.runPromise(h.commands.observeOperation(change));
      h.delivery.observeChanges(pending);
    };
    try {
      send(
        claudeSdkMessageFixture({
          type: "user",
          origin: { kind: "auto-continuation" },
          message: { content: "Continue the check" },
        }),
      );
      await publish();
      expect(h.live()).toMatchObject({ activity: "running", foregroundTurnActive: true });
      expect(
        await Effect.runPromise(
          h.delivery.submit({
            ...h.target,
            submissionId: "queued",
            mode: "default",
            parts: [{ kind: "text", text: "Next" }],
          }),
        ),
      ).toMatchObject({ kind: "queued" });
      const updating = Effect.runPromiseExit(
        h.commands.updateSessionModel({
          ...h.target,
          model: { providerId: "provider", modelId: "next", profileId: "build" },
        }),
      );
      await h.waiting;
      expect(h.native.models).toBe(0);
      send(
        claudeSdkMessageFixture({
          type: "result",
          subtype: "success",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          result: "Checks complete",
          origin: { kind: "auto-continuation" },
        }),
      );
      expect(h.live()).toMatchObject({ activity: "idle", foregroundTurnActive: false });
      await publish();
      expect(await updating).toMatchObject({ _tag: "Success" });
      await Promise.all(h.background.splice(0).map((effect) => Effect.runPromise(effect)));
      expect(h.order).toEqual(["settings", "send:next"]);
      expect(h.delivery.listQueues(target.repoPath)).toEqual([]);
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test.each(["waiting_for_question", "waiting_for_permission"] as const)(
    "keeps settings pending for child %s after the foreground turn ends",
    async (activity) => {
      const h = setup("opencode", Effect.succeed(settingsCatalog));
      h.setActivity(activity);
      h.setForeground(false);
      const updating = Effect.runPromise(
        h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
      );
      try {
        await h.waiting;
        await Effect.runPromise(Effect.yieldNow);
        expect(h.native.models).toBe(0);
        h.setActivity("running");
        await Effect.runPromise(
          h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
        );
        await updating;
        expect(h.order).toEqual(["settings"]);
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test("applies settings before queue delivery between foreground turns with background work", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    h.setForeground(true);
    h.delivery.observeChanges([{ type: "session_upsert", session: h.live() }]);
    try {
      await Effect.runPromise(
        h.delivery.submit({
          ...h.target,
          submissionId: "queued",
          mode: "default",
          parts: [{ kind: "text", text: "Next" }],
        }),
      );
      const updating = Effect.runPromise(
        h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
      );
      await h.waiting;
      h.setForeground(false);
      const free = { type: "session_upsert" as const, session: h.live() };
      await Effect.runPromise(h.commands.observeOperation(free));
      h.delivery.observeChanges([
        {
          type: "transcript_event",
          event: {
            type: "session_turn_finished",
            sessionRef: h.target,
            externalSessionId: h.target.externalSessionId,
            timestamp: "2026-10-13T12:01:00Z",
            completionId: "automatic-result",
            messageIds: [],
            turnOutcome: "completed",
          },
        },
        free,
      ]);
      await Promise.all([
        updating,
        ...h.background.splice(0).map((effect) => Effect.runPromise(effect)),
      ]);
      expect(h.order).toEqual(["settings", "send:next"]);
      expect(h.live().activity).toBe("running");
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test("fails pending settings with the current status failure", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    h.setForeground(true);
    const updating = Effect.runPromise(
      h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
    ).catch((cause: Error) => cause);
    try {
      await h.waiting;
      h.setForeground(false);
      h.setUnavailable("Claude status is unavailable. Reconnect the session.");
      await Effect.runPromise(
        h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
      );
      expect(await updating).toMatchObject({
        message: "Claude status is unavailable. Reconnect the session.",
      });
      expect(h.native.models).toBe(0);
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test.each(["waiting_for_question", "waiting_for_permission"] as const)(
    "keeps settings pending when the runtime read changes to %s",
    async (activity) => {
      const h = setup("opencode", Effect.succeed(settingsCatalog), ["running", activity]);
      let settled = false;
      const updating = Effect.runPromise(
        h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
      )
        .catch((cause: Error) => cause)
        .then((result) => {
          settled = true;
          return result;
        });
      try {
        await h.waiting;
        await Effect.runPromise(Effect.yieldNow);
        expect(settled).toBe(false);
        expect(h.native.models).toBe(0);
        h.setActivity("idle");
        await Effect.runPromise(
          h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
        );
        expect(await updating).toBeUndefined();
        expect(h.order).toEqual(["settings"]);
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test("answers a question while settings wait for the turn to finish", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    const updating = Effect.runPromise(
      h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
    ).catch((cause: Error) => cause);
    try {
      await h.waiting;
      h.setActivity("waiting_for_question");
      await Effect.runPromise(
        h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
      );
      await Effect.runPromise(
        h.commands.replyQuestion({
          ...h.target,
          requestId: "question-1",
          answers: [["Proceed"]],
        }),
      );
      expect(h.order).toEqual(["answer"]);
      expect(h.native.models).toBe(0);
      h.setActivity("idle");
      await Effect.runPromise(
        h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
      );
      expect(await updating).toBeUndefined();
      expect(h.order).toEqual(["answer", "settings"]);
      expect(h.native).toEqual({ sends: 0, models: 1 });
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test("applies settings before an idle event drains a queued message", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    h.delivery.observeChanges([{ type: "session_upsert", session: h.live() }]);
    try {
      await Effect.runPromise(
        h.delivery.submit({
          ...h.target,
          submissionId: "queued",
          mode: "default",
          parts: [{ kind: "text", text: "Next" }],
        }),
      );
      const updating = Effect.runPromise(
        h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
      );
      expect(h.order).toEqual([]);
      h.setActivity("idle");
      const idle = { type: "session_upsert" as const, session: h.live() };
      await Effect.runPromise(h.commands.observeOperation(idle));
      h.delivery.observeChanges([
        idle,
        {
          type: "transcript_event",
          event: {
            type: "session_idle",
            sessionRef: h.target,
            externalSessionId: h.target.externalSessionId,
            timestamp: "2026-10-13T12:01:00Z",
            turnOutcome: "completed",
          },
        },
      ]);
      await Promise.all([
        updating,
        ...h.background.splice(0).map((effect) => Effect.runPromise(effect)),
      ]);
      expect(h.order).toEqual(["settings", "send:next"]);
      expect(h.native).toEqual({ sends: 1, models: 1 });
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test.each([false, true])(
    "Stop cancels pending settings, catalog pending=%s",
    async (catalogPending) => {
      const gate = Deferred.makeUnsafe<void>();
      const catalogRead = Promise.withResolvers<void>();
      const h = setup(
        "opencode",
        Effect.sync(() => catalogRead.resolve()).pipe(
          Effect.andThen(catalogPending ? Deferred.await(gate) : Effect.void),
          Effect.as(settingsCatalog),
        ),
      );
      h.setActivity(catalogPending ? "idle" : "running");
      const updating = Effect.runPromise(
        h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
      ).catch((cause: Error) => cause);
      try {
        await (catalogPending ? catalogRead.promise : h.waiting);
        const stopStarted = Promise.withResolvers<void>();
        const stopping = Effect.runPromise(
          h.commands.stopSession(h.target, { onValidated: () => stopStarted.resolve() }),
        );
        await stopStarted.promise;
        Deferred.doneUnsafe(gate, Exit.void);
        await stopping;
        expect(await updating).toMatchObject({ message: expect.stringContaining("Stop canceled") });
        expect(h.order).toEqual(["stop"]);
        expect(h.native.models).toBe(0);
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test("rechecks the saved session after waiting for the turn to finish", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    const updating = Effect.runPromise(
      h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
    ).catch((cause: Error) => cause);
    try {
      await h.waiting;
      h.removeRecord();
      h.setActivity("idle");
      await Effect.runPromise(
        h.commands.observeOperation({ type: "session_upsert", session: h.live() }),
      );
      expect(await updating).toBeInstanceOf(Error);
      expect(h.native.models).toBe(0);
      expect(h.order).toEqual([]);
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test("a replacement snapshot cancels settings for a removed session", async () => {
    const h = setup("opencode", Effect.succeed(settingsCatalog));
    h.setActivity("running");
    const updating = Effect.runPromise(
      h.commands.updateSessionModel({ ...h.target, model: selection("next") }),
    ).catch((cause: Error) => cause);
    try {
      await h.waiting;
      h.detach();
      await Effect.runPromise(
        h.commands.observeOperation({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [],
          messageQueues: [],
        }),
      );
      expect(await updating).toMatchObject({ message: expect.stringContaining("session stopped") });
      expect(h.native.models).toBe(0);
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });

  test("Send fails clearly for a detached session without resuming it", async () => {
    const h = setup("opencode");
    h.detach();
    try {
      await expect(
        Effect.runPromise(
          h.commands.sendUserMessage({
            ...h.target,
            delivery: "new_turn",
            parts: [{ kind: "text", text: "Hello" }],
          }),
        ),
      ).rejects.toThrow("not attached");
      expect(h.native).toEqual({ sends: 0, models: 0 });
    } finally {
      await Effect.runPromise(h.commands.shutdownOperations());
    }
  });
});
