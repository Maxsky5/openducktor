import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { repoConfigSchema, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { initialSpeedState, SessionTurnAdmission } from "@openducktor/core";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  acceptedMessageText,
  createRuntimeHarness,
  ignoreObservationLoss,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { type HostError } from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createAgentSessionCommandService } from "../agent-sessions/agent-session-command-service";
import { createAgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import { createWorkspaceSessionRuntimePersistence } from "./workspace-session-runtime-persistence";
import { createPersistenceHarness } from "./test-support/workspace-session-runtime-persistence-harness";

describe("Workspace Session runtime rename through the real OpenCode live adapter", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  test("completes the first send and renames the runtime session", async () => {
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
    const store = createSqliteWorkspaceSessionStore(database.contextProvider);
    await Effect.runPromise(
      store.create({
        ...storeRef,
        session: {
          id: "session-1",
          runtimeKind: "opencode",
          externalSessionId: "native",
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: ref.workingDirectory,
            branchName: "feature/session",
            worktreeState: "present",
          },
          roleSnapshot: { id: "role", name: "Role", systemPrompt: "Instructions." },
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          createdAt: 0,
          updatedAt: 0,
          speed: "standard",
          archivedAt: null,
        },
      }),
    );
    let updateSessionTitle:
      | ((
          input: AgentSessionControlUpdateTitleInput,
        ) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>)
      | null = null;
    const persistence = createWorkspaceSessionRuntimePersistence({
      store,
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
        isRegisteredWorktree: () => Effect.succeed(true),
      }),
      publishUpdated: () => Effect.void,
      operationGate: createWorkspaceSessionOperationGate(),
      sessionTitleGate: createWorkspaceSessionOperationGate(),
      updateRuntimeSessionTitle: (input) =>
        updateSessionTitle
          ? updateSessionTitle(input)
          : Effect.die(new Error("live title update is not wired")),
      reportRenameFailure: () => Effect.void,
    });
    const live = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      runtimeAdmission: { admit: (_runtimeKind, effect) => effect },
      persistence,
      faultLog: () => Effect.void,
      publish: () => {},
    });
    updateSessionTitle = (input) => live.updateSessionTitle(input);
    const harness = createRuntimeHarness();
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: live,
        prepareRuntime: harness.prepareRuntime,
      })(
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
          startedAt: "2026-07-16T10:00:00.000Z",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        },
        ignoreObservationLoss,
      ),
    );
    await Effect.runPromise(live.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(
      live.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "repository" },
      }),
    );
    const commands = createAgentSessionCommandService({
      runtime: live,
      repositoryPolicy: persistence,
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader: { getTask: () => Effect.die(new Error("unexpected task read")) },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected task session read")),
        agentSessionUpsert: () => Effect.die(new Error("unexpected task session write")),
        transitionTask: () => Effect.die(new Error("unexpected task transition")),
      },
      taskLifecycle: { acquireLifecycle: () => Effect.die(new Error("unexpected task lifecycle")) },
      taskSessionStart: {
        prepare: () => Effect.die(new Error("unexpected task start")),
        complete: () => Effect.die(new Error("unexpected task completion")),
      },
      persistTaskModel: () => Effect.die(new Error("unexpected task model write")),
    });
    await Effect.runPromise(
      commands.sendUserMessage({
        ...ref,
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Name this chat" }],
      }),
    );
    const titleCalls = harness.controlCalls.filter((call) => call.operation === "title");
    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]?.input).toMatchObject({
      externalSessionId: "native",
      title: acceptedMessageText,
    });
    expect((await Effect.runPromise(store.get(storeRef))).generatedTitle).toBe(acceptedMessageText);
  });
});

describe("Workspace Session speed recovery", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  test.each([true, false])(
    "keeps the known model when speed recovery retries a failed save (live model: %s)",
    async (hasLiveModel) => {
      const nativeModel = { providerId: "openai", modelId: "gpt-5.6-sol", variant: "high" };
      const admission = new SessionTurnAdmission();
      admission.setBlocked(true);
      let speed = initialSpeedState(null, "uncertain");
      const harness = await createPersistenceHarness(database, "codex", false, () => ({
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
              title: "Imported session",
              startedAt: "2026-09-07T10:00:00Z",
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
      }));
      const previousModel = { ...harness.record.selectedModel!, profileId: "build" };
      await Effect.runPromise(
        harness.store.setSelectedModel({ ...harness.storeRef, selectedModel: previousModel }),
      );
      const input = {
        ...harness.ref,
        sessionScope: { kind: "repository" as const },
        speed: "standard",
      };
      harness.state.failModelSave = true;
      await expect(Effect.runPromise(harness.live.updateSessionSpeed(input))).rejects.toThrow(
        "model save failed",
      );
      expect((await harness.get()).selectedModel).toEqual(previousModel);
      expect(harness.updates).toEqual([]);
      expect(speed.synchronization).toBe("uncertain");
      await expect(admission.run(async () => "new turn")).rejects.toThrow();

      harness.state.failModelSave = false;
      await Effect.runPromise(harness.live.updateSessionSpeed(input));
      const expectedModel = hasLiveModel
        ? { ...nativeModel, runtimeKind: "codex" as const, profileId: "build" }
        : previousModel;
      expect((await harness.get()).selectedModel).toEqual(expectedModel);
      expect(harness.updates).toEqual([
        expect.objectContaining({
          session: expect.objectContaining({ selectedModel: expectedModel }),
        }),
      ]);
      expect(speed).toMatchObject({ choice: "standard", synchronization: "confirmed" });
      expect(await admission.run(async () => "new turn")).toBe("new turn");
      await harness.send("Continue after recovery");
      expect(harness.inputs).toEqual([
        expect.objectContaining({ model: expectedModel, speed: "standard" }),
      ]);
    },
  );
});
