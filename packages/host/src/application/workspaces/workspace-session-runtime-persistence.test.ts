import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentSessionControlResumeInput,
  AgentSessionControlUpdateModelInput,
  AgentSessionControlSendInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionTranscriptEvent,
  WorkspaceSession,
} from "@openducktor/contracts";
import { repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { HostOperationError } from "../../effect/host-errors";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import { createAgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionRuntimePersistence } from "./workspace-session-runtime-persistence";
import { createWorkspaceSessionService } from "./workspace-session-service";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import { createAgentSessionCommandService } from "../agent-sessions/agent-session-command-service";

describe("Workspace Session persistence through the shared command module", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  const setup = async () => {
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
    const state = {
      failSend: false,
      failModel: false,
      failModelSave: false,
      failRestore: false,
      failPublish: false,
      failActivity: false,
      registered: true,
      beforeControl: Effect.void,
      beforeModelSave: Effect.void,
      onGateRequest: () => {},
      active: false,
    };
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
    const persistence = createWorkspaceSessionRuntimePersistence({
      operationGate,
      store: {
        ...store,
        recordAcceptedMessage: (input) =>
          state.failActivity
            ? failure("activity write failed")
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
          return state.failActivity
            ? failure("activity write failed")
            : store.recordActivity(input);
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
    });
    const live = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      persistence,
      faultLog: () => Effect.void,
      publish: (event) => {
        events.push(event);
      },
    });
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
                  return state.failSend
                    ? failure("runtime rejected message")
                    : Effect.succeed(accepted());
                }),
              ),
            ),
          updateSessionModel: (input) =>
            Effect.suspend(() => {
              models.push(input.model);
              if (state.failModel) return failure("runtime rejected model");
              if (state.failRestore && models.length === 2)
                return failure("runtime restore failed");
              return Effect.void;
            }),
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
    const emit = (event: AgentSessionTranscriptEvent) =>
      Effect.runPromise(
        registration.runMutation(
          Effect.succeed({ value: undefined, changes: [{ type: "transcript_event", event }] }),
        ),
      );
    const get = () => Effect.runPromise(store.get(storeRef));
    return {
      operationGate,
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
      state,
      accepted,
      emit,
      get,
    };
  };

  test("uses the stored Role and Model on resume and send after catalog edits or deletion", async () => {
    const h = await setup();
    const scope = { kind: "repository" } as const;
    await Effect.runPromise(
      h.live.resumeSession({
        resumeMode: "reattach",
        ...h.ref,
        sessionScope: scope,
        systemPrompt: "New catalog instructions.",
        model: { providerId: "other", modelId: "other-model" },
      }),
    );
    await Effect.runPromise(
      h.live.sendUserMessage({
        ...h.ref,
        sessionScope: scope,
        systemPrompt: "Client override",
        parts: [{ kind: "text", text: "Prompt" }],
      }),
    );
    expect(h.inputs).toHaveLength(2);
    for (const input of h.inputs)
      expect(input).toMatchObject({
        systemPrompt: "Original instructions.",
        model: h.record.selectedModel,
      });
    const saved = await h.get();
    expect(saved.generatedTitle).toBe("First accepted prompt");
    expect(saved.updatedAt).toBe(Date.parse("2026-09-07T10:00:00Z"));
    expect(h.updates.at(-1)).toEqual({ workspaceId: "fairnest", session: saved });
  });

  test("does not persist rejected sends or model changes and saves an accepted model", async () => {
    const h = await setup();
    h.state.failSend = true;
    await expect(
      Effect.runPromise(
        h.live.sendUserMessage({
          ...h.ref,
          sessionScope: { kind: "repository" },
          parts: [{ kind: "text", text: "Rejected" }],
        }),
      ),
    ).rejects.toThrow("runtime rejected message");
    expect(await h.get()).toEqual(h.record);
    h.state.failModel = true;
    const model = { providerId: "provider", modelId: "new-model", variant: "low" };
    const update = { ...h.ref, sessionScope: { kind: "repository" as const }, model };
    await expect(Effect.runPromise(h.live.updateSessionModel(update))).rejects.toThrow(
      "runtime rejected model",
    );
    expect(await h.get()).toEqual(h.record);
    h.state.failModel = false;
    await Effect.runPromise(h.live.updateSessionModel(update));
    expect((await h.get()).selectedModel).toEqual({ ...model, runtimeKind: "opencode" });
    expect((await h.get()).updatedAt).toBe(0);
  });

  test.each([false, true])(
    "restores the native model after a failed durable save, restore failure=%s",
    async (failRestore) => {
      const h = await setup();
      h.state.failModelSave = true;
      h.state.failRestore = failRestore;
      const model = { providerId: "provider", modelId: "new-model" };
      await expect(
        Effect.runPromise(
          h.live.updateSessionModel({
            ...h.ref,
            sessionScope: { kind: "repository" },
            model,
          }),
        ),
      ).rejects.toThrow(failRestore ? "Runtime model restore failed" : "model save failed");
      expect(h.models).toEqual([model, h.record.selectedModel]);
      expect((await h.get()).selectedModel).toEqual(h.record.selectedModel);
      expect(h.updates).toEqual([]);
    },
  );

  test("does not roll back a saved model when publication fails", async () => {
    const h = await setup();
    h.state.failPublish = true;
    const model = { providerId: "provider", modelId: "new-model" };
    await expect(
      Effect.runPromise(
        h.live.updateSessionModel({
          ...h.ref,
          sessionScope: { kind: "repository" },
          model,
        }),
      ),
    ).rejects.toThrow("publication failed");
    expect(h.models).toEqual([model]);
    expect((await h.get()).selectedModel).toEqual({ ...model, runtimeKind: "opencode" });
  });

  test.each([
    { providerId: "provider", modelId: "stored-model", variant: "low" },
    { providerId: "other", modelId: "new-model" },
  ])("keeps the stored profile when model settings change to %j", async (model) => {
    const h = await setup();
    await Effect.runPromise(
      h.store.setSelectedModel({
        ...h.storeRef,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "provider",
          modelId: "stored-model",
          variant: "high",
          profileId: "review-only",
        },
      }),
    );
    await Effect.runPromise(
      h.live.updateSessionModel({ ...h.ref, sessionScope: { kind: "repository" }, model }),
    );
    const expectedModel: WorkspaceSession["selectedModel"] = {
      ...model,
      runtimeKind: "opencode",
      profileId: "review-only",
    };
    expect((await h.get()).selectedModel).toEqual(expectedModel);
    await Effect.runPromise(
      h.live.resumeSession({
        resumeMode: "reattach",
        ...h.ref,
        sessionScope: { kind: "repository" },
      }),
    );
    await Effect.runPromise(
      h.live.sendUserMessage({
        ...h.ref,
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Continue" }],
      }),
    );
    expect(h.inputs.map((input) => input.model)).toEqual([expectedModel, expectedModel]);
  });

  test("does not save any accepted-message fields when its model is invalid", async () => {
    const h = await setup();
    await expect(
      Effect.runPromise(
        h.persistence.recordAcceptedMessage(h.ref, {
          ...h.accepted(),
          model: { runtimeKind: "codex", providerId: "provider", modelId: "wrong-runtime" },
        }),
      ),
    ).rejects.toThrow("Accepted message model does not match its Runtime");
    expect(await h.get()).toEqual(h.record);
    expect(h.updates).toEqual([]);
  });

  test("keeps the saved profile during model compensation", async () => {
    const h = await setup();
    const previousModel = {
      runtimeKind: "opencode" as const,
      providerId: "provider",
      modelId: "stored-model",
      profileId: "review-only",
    };
    await Effect.runPromise(
      h.store.setSelectedModel({ ...h.storeRef, selectedModel: previousModel }),
    );
    h.state.failModelSave = true;
    const model = { providerId: "provider", modelId: "new-model" };
    await expect(
      Effect.runPromise(
        h.live.updateSessionModel({ ...h.ref, sessionScope: { kind: "repository" }, model }),
      ),
    ).rejects.toThrow("model save failed");
    expect(h.models).toEqual([model, previousModel]);
    expect((await h.get()).selectedModel).toEqual(previousModel);
    expect(h.updates).toEqual([]);
  });

  test("keeps the complete accepted-message update after publication fails", async () => {
    const h = await setup();
    h.state.failPublish = true;
    const model = { runtimeKind: "opencode" as const, providerId: "provider", modelId: "chosen" };
    await expect(
      Effect.runPromise(h.persistence.recordAcceptedMessage(h.ref, { ...h.accepted(), model })),
    ).rejects.toThrow("publication failed");
    expect(await h.get()).toEqual({
      ...h.record,
      generatedTitle: "First accepted prompt",
      updatedAt: Date.parse(h.accepted().timestamp),
      selectedModel: model,
    });
    expect(h.updates).toEqual([]);
  });

  test("finishes model compensation before a queued model change enters the runtime", async () => {
    const h = await setup();
    const saving = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    let requests = 0;
    h.state.onGateRequest = () => {
      if (++requests === 2) queued.resolve();
    };
    h.state.failModelSave = true;
    h.state.beforeModelSave = Effect.promise(async () => {
      saving.resolve();
      await finish.promise;
    });
    const firstModel = { providerId: "provider", modelId: "first" };
    const secondModel = { providerId: "provider", modelId: "second" };
    const first = Effect.runPromiseExit(
      h.live.updateSessionModel({
        ...h.ref,
        sessionScope: { kind: "repository" },
        model: firstModel,
      }),
    );
    await saving.promise;
    const second = Effect.runPromiseExit(
      h.live.updateSessionModel({
        ...h.ref,
        sessionScope: { kind: "repository" },
        model: secondModel,
      }),
    );
    await queued.promise;
    expect(h.models).toEqual([firstModel]);
    finish.resolve();
    expect((await first)._tag).toBe("Failure");
    expect((await second)._tag).toBe("Failure");
    expect(h.models).toEqual([
      firstModel,
      h.record.selectedModel,
      secondModel,
      h.record.selectedModel,
    ]);
    expect((await h.get()).selectedModel).toEqual(h.record.selectedModel);
  });

  test("does not replace the selected model when an older user message is replayed", async () => {
    const h = await setup();
    const model = { providerId: "provider", modelId: "new-model" };
    await Effect.runPromise(
      h.live.updateSessionModel({ ...h.ref, sessionScope: { kind: "repository" }, model }),
    );
    await h.emit({
      ...h.accepted(),
      model: { providerId: "provider", modelId: "old-model" },
      sessionRef: h.ref,
    });
    expect((await h.get()).selectedModel).toEqual({ ...model, runtimeKind: "opencode" });
  });

  test.each([
    ["send", "command"],
    ["send", "archive"],
    ["resume", "command"],
    ["resume", "archive"],
  ] as const)("serializes archive with %s when %s starts first", async (operation, first) => {
    const h = await setup();
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    let gateRequests = 0;
    let archiveReads = 0;
    let removals = 0;
    h.state.onGateRequest = () => {
      if (++gateRequests === 2) queued.resolve();
    };
    const pause = Effect.promise(async () => {
      entered.resolve();
      await finish.promise;
    });
    if (first === "command")
      h.state.beforeControl = pause.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            h.state.active = true;
          }),
        ),
      );
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Fairnest",
      repoPath: database.repoPath,
    });
    const workspace = createWorkspaceSessionService({
      operationGate: h.operationGate,
      store: h.store,
      settings: {
        getRepoConfig: () => Effect.succeed(config),
        listCustomAgentRoles: () => Effect.succeed([]),
      },
      runtime: { runtimeEnsure: () => Effect.dieMessage("unexpected runtime ensure") },
      live: {
        ...h.live,
        read: () =>
          (first === "archive" ? pause : Effect.void).pipe(
            Effect.map(() => {
              archiveReads++;
              return {
                type: "live" as const,
                session: {
                  ref: h.ref,
                  activity: h.state.active ? ("running" as const) : ("idle" as const),
                  title: "Session",
                  startedAt: "2026-09-07T10:00:00Z",
                  pendingApprovals: [],
                  pendingQuestions: [],
                  contextUsage: null,
                },
              };
            }),
          ),
      },
      git: createGitPortTestDouble({
        canonicalizePath: (value) => Effect.succeed(value),
        isGitRepository: () => Effect.succeed(true),
        shareGitCommonDirectory: () => Effect.succeed(true),
        isRegisteredWorktree: () => Effect.succeed(h.state.registered),
        getCurrentBranch: (directory) =>
          Effect.succeed({
            name: directory === database.repoPath ? "main" : "feature/session",
            detached: false,
          }),
        getStatus: () => Effect.succeed([]),
        referenceExists: () => Effect.succeed(false),
        removeWorktree: () =>
          Effect.sync(() => {
            removals++;
            h.state.registered = false;
          }),
      }),
      settingsConfig: createSettingsConfigTestDouble({ pathExists: () => Effect.succeed(true) }),
      worktreeFiles: createWorktreeFilePortTestDouble({}),
      systemCommands: {
        resolveCommandPath: () => Effect.dieMessage("unused"),
        versionCommand: () => Effect.dieMessage("unused"),
        runCommandAllowFailure: () => Effect.dieMessage("unused"),
      },
    });
    const command = () =>
      operation === "send"
        ? h.live
            .sendUserMessage({
              ...h.ref,
              sessionScope: { kind: "repository" },
              parts: [{ kind: "text", text: "Continue" }],
            })
            .pipe(Effect.asVoid)
        : h.live
            .resumeSession({
              resumeMode: "reattach",
              ...h.ref,
              sessionScope: { kind: "repository" },
            })
            .pipe(Effect.asVoid);
    const archive = () =>
      workspace
        .archive({
          workspaceId: "fairnest",
          sessionId: "session-1",
          removeWorktree: true,
          confirmStop: false,
        })
        .pipe(Effect.asVoid);
    const firstRun = Effect.runPromiseExit(first === "command" ? command() : archive());
    await entered.promise;
    const secondRun = Effect.runPromiseExit(first === "command" ? archive() : command());
    await queued.promise;
    expect(h.inputs).toEqual([]);
    expect(archiveReads).toBe(0);
    finish.resolve();
    const [a, b] = await Promise.all([firstRun, secondRun]);
    expect(a._tag).toBe("Success");
    expect(b._tag).toBe("Failure");
    expect(removals).toBe(first === "archive" ? 1 : 0);
    expect(h.inputs).toHaveLength(first === "command" ? 1 : 0);
  });

  test("generates the title once and does not move activity back for older user messages", async () => {
    const h = await setup();
    await h.emit({ ...h.accepted(), sessionRef: h.ref });
    await h.emit({ ...h.accepted("Duplicate with other text"), sessionRef: h.ref });
    await h.emit({ ...h.accepted("Older prompt", "2026-09-06T10:00:00Z"), sessionRef: h.ref });
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    expect((await h.get()).updatedAt).toBe(Date.parse("2026-09-07T10:00:00Z"));
  });

  test("records the final assistant time only on idle, ignoring deltas and duplicate idle events", async () => {
    const h = await setup();
    const base = {
      externalSessionId: "native",
      sessionRef: h.ref,
      timestamp: "2026-09-07T10:01:00Z",
    };
    await h.emit({ ...base, type: "assistant_delta", channel: "text", delta: "Partial" });
    await h.emit({
      ...base,
      type: "assistant_message",
      messageId: "assistant-1",
      message: "Final answer",
    });
    expect(h.activityTimes).toEqual([]);
    const idle = { ...base, timestamp: "2026-09-07T10:02:00Z", type: "session_idle" } as const;
    await h.emit(idle);
    await h.emit(idle);
    expect(h.activityTimes).toEqual([Date.parse(base.timestamp)]);
    expect((await h.get()).updatedAt).toBe(Date.parse(base.timestamp));
  });

  test("does not count retracted or older final messages as new activity", async () => {
    const h = await setup();
    await h.emit({ ...h.accepted(), sessionRef: h.ref });
    const base = {
      externalSessionId: "native",
      sessionRef: h.ref,
      timestamp: "2026-09-06T10:01:00Z",
    };
    await h.emit({ ...base, type: "assistant_message", messageId: "old", message: "Old answer" });
    await h.emit({ ...base, type: "session_idle" });
    await h.emit({
      ...base,
      timestamp: "2026-09-08T10:00:00Z",
      type: "assistant_message",
      messageId: "retracted",
      message: "Retracted answer",
    });
    await h.emit({ ...base, type: "transcript_retracted", messageIds: ["retracted"] });
    await h.emit({ ...base, type: "session_idle" });
    expect(h.activityTimes).toEqual([]);
    expect((await h.get()).updatedAt).toBe(Date.parse("2026-09-07T10:00:00Z"));
  });

  test("rejects target mismatch, missing worktrees, and archived sessions before calling the runtime", async () => {
    const h = await setup();
    const resume = {
      ...h.ref,
      sessionScope: { kind: "repository" } as const,
      resumeMode: "reattach" as const,
    };
    await expect(
      Effect.runPromise(h.live.resumeSession({ ...resume, workingDirectory: "/wrong" })),
    ).rejects.toThrow("does not match");
    h.state.registered = false;
    await expect(Effect.runPromise(h.live.resumeSession(resume))).rejects.toThrow(
      "not a registered worktree",
    );
    h.state.registered = true;
    await Effect.runPromise(h.store.archive({ ...h.storeRef, archivedAt: 1 }));
    await expect(Effect.runPromise(h.live.resumeSession(resume))).rejects.toThrow("Restore");
    expect(h.inputs).toEqual([]);
  });

  test.each(["resume", "send", "read", "model"] as const)(
    "%s keeps target and archive validation ahead of other session checks",
    async (operation) => {
      const h = await setup();
      const validate = (ref: AgentSessionLiveRef) => {
        switch (operation) {
          case "resume":
            return h.persistence.prepareResume({
              resumeMode: "reattach",
              ...ref,
              sessionScope: { kind: "repository" },
            });
          case "send":
            return h.persistence.prepareSend({
              ...ref,
              sessionScope: { kind: "repository" },
              parts: [{ kind: "text", text: "Prompt" }],
            });
          case "read":
            return h.persistence.validateRef(ref);
          case "model":
            return h.persistence.prepareModelUpdate({
              ...ref,
              sessionScope: { kind: "repository" },
              model: null,
            });
        }
      };
      await expect(
        Effect.runPromise(validate({ ...h.ref, workingDirectory: "/wrong" })),
      ).rejects.toThrow("does not match");
      h.state.registered = false;
      await expect(Effect.runPromise(validate(h.ref))).rejects.toThrow("not a registered worktree");
      await Effect.runPromise(h.store.archive({ ...h.storeRef, archivedAt: 1 }));
      await expect(Effect.runPromise(validate(h.ref))).rejects.toThrow("Restore");
      await Effect.runPromise(validate({ ...h.ref, externalSessionId: "unknown" }));
      expect(h.inputs).toEqual([]);
      expect(h.updates).toEqual([]);
    },
  );

  test("does not import unknown runtime sessions", async () => {
    const h = await setup();
    const unknown = { ...h.ref, externalSessionId: "unknown" };
    await h.emit({ ...h.accepted(), externalSessionId: "unknown", sessionRef: unknown });
    expect(await h.get()).toEqual(h.record);
    expect(h.updates).toEqual([]);
  });

  test("publishes the transcript and a scoped error when metadata persistence fails", async () => {
    const h = await setup();
    h.state.failActivity = true;
    const event = { ...h.accepted(), sessionRef: h.ref };
    await expect(h.emit(event)).rejects.toThrow("activity write failed");
    expect(h.events).toEqual([
      { type: "transcript_event", event },
      {
        type: "fault",
        repoPath: h.ref.repoPath,
        ref: h.ref,
        operation: "agent-session.persist",
        message: "activity write failed",
      },
    ]);
    expect(await h.get()).toEqual(h.record);
    expect(h.updates).toEqual([]);
  });
});
