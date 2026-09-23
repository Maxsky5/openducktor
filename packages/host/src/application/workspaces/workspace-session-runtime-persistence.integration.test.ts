import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { repoConfigSchema, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  acceptedUserMessageTitle,
  createRuntimeHarness,
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
          : Effect.dieMessage("live title update is not wired"),
      reportRenameFailure: () => Effect.void,
    });
    const live = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
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
      })({
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: database.repoPath,
        taskId: null,
        role: "workspace",
        workingDirectory: ref.workingDirectory,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
        startedAt: "2026-07-16T10:00:00.000Z",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
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
      title: acceptedUserMessageTitle,
    });
    expect((await Effect.runPromise(store.get(storeRef))).generatedTitle).toBe(
      acceptedUserMessageTitle,
    );
  });
});
