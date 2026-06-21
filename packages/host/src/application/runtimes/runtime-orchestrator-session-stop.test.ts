import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createGitPort,
  createRegistry,
  createRuntime,
  createRuntimeDefinitionsService,
  createRuntimeOrchestratorService,
  createTaskStore,
} from "./runtime-orchestrator-service.test-support";

describe("createRuntimeOrchestratorService agentSessionStop", () => {
  test("stops persisted agent sessions through the runtime registry", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({ workingDirectory: "/canonical/repo/worktree" });
    const registry = createRegistry([runtime], {
      ensureWorkspaceRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime ensure");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stopRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime stop");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stopSession(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      probeSessionStatus() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected session probe",
          }),
        );
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/canonical/repo",
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });

  test("stops persisted Codex sessions through the runtime registry", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({
      kind: "codex",
      runtimeId: "runtime-codex-1",
      workingDirectory: "/canonical/repo/worktree",
      runtimeRoute: { type: "stdio", identity: "runtime-codex-1" },
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    });
    const registry = createRegistry([runtime], {
      ensureWorkspaceRuntime() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected runtime ensure",
          }),
        );
      },
      stopSession(input) {
        return Effect.sync(() => {
          calls.push(input);
        });
      },
      probeSessionStatus() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected session probe",
          }),
        );
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore({ runtimeKind: "codex" }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "codex",
        repoPath: "/canonical/repo",
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });

  test("stops the exact persisted session when external ids collide", async () => {
    const calls: unknown[] = [];
    const registry = createRegistry([createRuntime()], {
      stopSession(input) {
        return Effect.sync(() => {
          calls.push(input);
        });
      },
      probeSessionStatus() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected session probe",
          }),
        );
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(
        {
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/old-worktree",
        },
        [
          {
            externalSessionId: "shared-session",
            role: "build",
            startedAt: "2026-05-10T11:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/canonical/repo/target-worktree",
            selectedModel: null,
          },
        ],
      ),
    });

    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/target-worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/canonical/repo",
        externalSessionId: "shared-session",
        workingDirectory: "/canonical/repo/target-worktree",
      },
    ]);
  });

  test("rejects agent session stop when persisted session identity mismatches the request", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([createRuntime()]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Agent session external-session-1 (codex, /canonical/repo/worktree)");
  });

  test("propagates runtime registry stop failures", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([createRuntime()], {
        stopSession() {
          return Effect.fail(
            new HostOperationError({
              operation: "runtimeRegistry.stopSession",
              message: "runtime stop failed",
            }),
          );
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("runtime stop failed");
  });
});
