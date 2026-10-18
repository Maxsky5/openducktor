import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  agentMessageSubmitInputSchema,
  agentModelCatalogSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  taskCardSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionLiveSnapshot,
  type AgentSessionModelSelection,
} from "@openducktor/contracts";
import { AgentSessionBusyError } from "../../ports/agent-session-send-error";
import { createAgentSessionCommandService } from "./agent-session-command-service";
import { createSessionTurnPreparation } from "./session-turn-preparation";
import { createAgentMessageDeliveryService } from "./agent-message-delivery-service";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";

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

const setup = ({
  image = false,
  mimeTypes = ["image/png"],
  saved = selection(),
  running = selection(),
} = {}) => {
  let savedModel = saved;
  let activity: AgentSessionLiveSnapshot["activity"] = "idle";
  let catalog = agentModelCatalogSchema.parse({
    runtime: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    models: [
      {
        id: "provider/current",
        providerId: "provider",
        providerName: "Provider",
        modelId: "current",
        modelName: "Current",
        variants: [],
        attachmentSupport: {
          image,
          audio: false,
          video: false,
          pdf: false,
          mimeTypes: { image: mimeTypes },
        },
      },
      {
        id: "provider/running",
        providerId: "provider",
        providerName: "Provider",
        modelId: "running",
        modelName: "Running",
        variants: [],
        attachmentSupport: { image: false, audio: false, video: false, pdf: false },
      },
    ],
    defaultModelsByProvider: { provider: "current" },
    profiles: [{ name: "build", mode: "primary" }],
  });
  const native = { sends: 0, models: 0 };
  const live = (): AgentSessionLiveSnapshot => ({
    ref: target,
    title: "Session",
    startedAt: "2026-10-13T12:00:00Z",
    activity,
    model: savedModel,
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
  });
  const taskReader = {
    getTask: () =>
      Effect.succeed(
        taskCardSchema.parse({
          id: "task-1",
          title: "Task",
          description: "",
          status: "in_progress",
          priority: 2,
          issueType: "task",
          aiReviewEnabled: true,
          createdAt: "2026-10-13T12:00:00Z",
          updatedAt: "2026-10-13T12:00:00Z",
        }),
      ),
  };
  const queries = {
    loadKnownRuntimeCatalog: () =>
      Effect.succeed({ models: { status: "available" as const, catalog } }),
    loadSessionHistory: () =>
      Effect.succeed([
        // OpenCode exposes the active model on assistant rows.
        {
          role: "user" as const,
          messageId: "turn-input",
          timestamp: "2026-10-13T12:00:00Z",
          text: "Start",
          state: "read" as const,
          displayParts: [],
          parts: [],
        },
        {
          role: "assistant" as const,
          messageId: "native-response",
          timestamp: "2026-10-13T12:00:01Z",
          text: "",
          parts: [],
          model: running,
        },
      ]),
  };
  const unexpected = () => Effect.die(new Error("Unexpected native work"));
  const commands = createAgentSessionCommandService({
    canonicalizeRepoPath: Effect.succeed,
    taskReader,
    taskLifecycle: createTaskSessionLifecycleCoordinator(),
    taskSessionStart: { prepare: unexpected, complete: unexpected },
    persistTaskModel: () => Effect.succeed({ updated: true, publish: Effect.void }),
    pauseForStop: () => Effect.void,
    approvalPolicy: { reply: unexpected },
    readSessionRootRefs: () => Effect.succeed([target]),
    turnPreparation: createSessionTurnPreparation({
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
      read: () => Effect.succeed({ type: "live" as const, session: live() }),
      list: () => Effect.succeed([live()]),
      publishOperation: () => Effect.void,
      retainOperation: () => Effect.void,
      startSession: unexpected,
      forkSession: unexpected,
      resumeSession: unexpected,
      continueInterruptedTurn: unexpected,
      releaseSession: unexpected,
      stopSession: unexpected,
      loadContext: unexpected,
      loadSessionDiff: unexpected,
      replyApproval: unexpected,
      replyQuestion: unexpected,
      updateSessionModel: () =>
        Effect.sync(() => {
          native.models += 1;
        }),
      sendUserMessage: (input) =>
        Effect.suspend(() => {
          if (activity === "running" && input.delivery !== "steer")
            return Effect.fail(
              new AgentSessionBusyError({
                message: "Session is working",
                cause: new Error("Turn active"),
              }),
            );
          return Effect.sync(() => {
            native.sends += 1;
            return {
              type: "user_message" as const,
              externalSessionId: "root",
              messageId: "accepted",
              timestamp: "2026-10-13T12:00:00Z",
              message: "Message",
              parts: input.parts.filter((part) => part.kind !== "slash_command"),
              state: "read" as const,
            };
          });
        }),
    },
    tasks: {
      agentSessionsList: () =>
        Effect.succeed([
          {
            externalSessionId: "root",
            runtimeKind: "opencode",
            workingDirectory: "/repo/tree",
            role: "build",
            selectedModel: savedModel,
            startedAt: "2026-10-13T12:00:00Z",
          },
        ]),
      agentSessionUpsert: unexpected,
      agentSessionUpdateModel: () => Effect.succeed(true),
      transitionTask: unexpected,
    },
    repositoryPolicy: {
      run: (_ref, _op, work) => work,
      runSend: (_ref, work) => work,
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
    runInBackground: () => {},
    now: () => "2026-10-13T12:00:00Z",
  });
  return {
    commands,
    delivery,
    native,
    setSavedModel: (value: AgentSessionModelSelection) => {
      savedModel = value;
    },
    setActivity: (value: typeof activity) => {
      activity = value;
    },
    removeCurrentModel: () => {
      catalog = {
        ...catalog,
        models: catalog.models.filter((model) => model.modelId !== "current"),
      };
    },
  };
};

describe("host message content and captured model validation", () => {
  test.each([
    { image: false, saved: selection(), mime: "image/png", name: "image.png" },
    { image: true, saved: selection(), mime: "image/webp", name: "image.png" },
    { image: false, saved: selection("removed"), mime: "image/png", name: "image.png" },
  ])(
    "rejects disallowed attachments before model or message effects: %j",
    async ({ image, saved, mime, name }) => {
      const h = setup({ image, saved });
      try {
        const input = agentMessageSubmitInputSchema.parse({
          ...target,
          submissionId: "message",
          mode: "default",
          parts: [{ ...attachment, attachment: { ...attachment.attachment, mime, name } }],
        });
        const result = await Effect.runPromise(Effect.result(h.delivery.submit(input)));
        expect(result._tag).toBe("Failure");
        expect(h.native).toEqual({ sends: 0, models: 0 });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test.each(["image/png", "image/jpg"])(
    "admits a MIME listed by the authoritative model: %j",
    async (mime) => {
      const h = setup({ image: true, mimeTypes: [mime] });
      try {
        const result = await Effect.runPromise(
          h.delivery.submit({
            ...target,
            submissionId: "supported",
            mode: "default",
            parts: [
              {
                ...attachment,
                attachment: {
                  ...attachment.attachment,
                  mime,
                  name: mime === "image/jpg" ? "image.jpg" : "image.png",
                },
              },
            ],
          }),
        );
        expect(result.kind).toBe("accepted");
        expect(h.native).toEqual({ sends: 1, models: 0 });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test.each(["current", "running"])(
    "steering checks the native running turn model %j",
    async (modelId) => {
      const h = setup({ image: true, running: selection(modelId) });
      h.setActivity("running");
      try {
        const result = await Effect.runPromise(
          Effect.result(
            h.commands.sendUserMessage({ ...target, parts: [attachment], delivery: "steer" }),
          ),
        );
        expect(result._tag).toBe(modelId === "current" ? "Success" : "Failure");
        expect(h.native).toEqual({ sends: modelId === "current" ? 1 : 0, models: 0 });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test.each([false, true])(
    "Queue Save validates the captured model, available=%j",
    async (available) => {
      const h = setup({ image: true });
      h.setActivity("running");
      h.delivery.observeChanges([
        {
          type: "session_upsert",
          session: {
            ref: target,
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
            ...target,
            submissionId: "queued",
            mode: "default",
            parts: [{ kind: "text", text: "Original" }],
          }),
        );
        const edited = await Effect.runPromise(
          h.delivery.manage({ ...target, action: { kind: "begin_edit", submissionId: "queued" } }),
        );
        const entry = edited.queue.entries[0];
        if (entry?.state !== "editing") throw new Error("Missing edit reservation");
        h.setSavedModel(selection("running"));
        if (!available) h.removeCurrentModel();
        const result = await Effect.runPromise(
          Effect.result(
            h.delivery.manage({
              ...target,
              action: {
                kind: "save_edit",
                submissionId: "queued",
                editId: entry.editId,
                parts: [attachment],
              },
            }),
          ),
        );
        if (available) {
          expect(result._tag).toBe("Success");
          expect(h.delivery.listQueues("/repo")[0]?.entries[0]).toMatchObject({
            state: "queued",
            model: entry.model,
            parts: [attachment],
          });
        } else {
          expect(result._tag).toBe("Failure");
          expect(h.delivery.listQueues("/repo")[0]?.entries[0]).toEqual(entry);
        }
        expect(h.native).toEqual({ sends: 0, models: 0 });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );
});
