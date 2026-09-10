import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { createRuntimeRegistry } from "./runtime-registry";

const createRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  ...overrides,
});

const createCodexRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary =>
  createRuntime({
    kind: "codex",
    runtimeId: "runtime-1",
    runtimeRoute: { type: "stdio", identity: "runtime-1" },
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    ...overrides,
  });

describe("createRuntimeRegistry workspace runtime lookup", () => {
  test("publishes lifecycle changes after the runtime lookup changes", async () => {
    const changes: Array<{ state: string; runtimeId: string | null }> = [];
    let alive = true;
    let starts = 0;
    const registry = createRuntimeRegistry({
      workspaceStarter: {
        startWorkspaceRuntime: () =>
          Effect.sync(() => ({
            runtime: createRuntime({ runtimeId: `runtime-${++starts}` }),
            configuredExecutablePath: "/bin/opencode",
            isAlive: () => alive,
            stop: () => Effect.void,
          })),
      },
      onRuntimeChanged: (runtime, state) =>
        Effect.gen(function* () {
          const current = yield* registry
            .findWorkspaceRuntime({ repoPath: runtime.repoPath, runtimeKind: runtime.kind })
            .pipe(Effect.orDie);
          changes.push({ state, runtimeId: current?.runtimeId ?? null });
        }),
    });
    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
    };
    await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    alive = false;
    await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
    expect(changes).toEqual([
      { state: "ready", runtimeId: "runtime-1" },
      { state: "stopped", runtimeId: null },
      { state: "ready", runtimeId: "runtime-2" },
    ]);
  });
  test("finds the live workspace runtime by repository and kind", async () => {
    const workspaceRuntime = createRuntime({
      runtimeId: "workspace-opencode",
      repoPath: "C:\\Repo",
      workingDirectory: "C:\\Repo",
    });
    const taskRuntime = createRuntime({
      runtimeId: "task-opencode",
      repoPath: "c:/repo",
      taskId: "task-1",
      workingDirectory: "c:/repo/task",
    });
    const codexRuntime = createCodexRuntime({
      runtimeId: "workspace-codex",
      repoPath: "c:/repo",
      workingDirectory: "c:/repo",
    });
    const registry = createRuntimeRegistry({
      runtimes: [taskRuntime, codexRuntime, workspaceRuntime],
    });

    await expect(
      Effect.runPromise(
        registry.findWorkspaceRuntime({ repoPath: "c:/repo", runtimeKind: "opencode" }),
      ),
    ).resolves.toEqual(workspaceRuntime);
    await expect(
      Effect.runPromise(
        registry.findWorkspaceRuntime({ repoPath: "c:/repo", runtimeKind: "codex" }),
      ),
    ).resolves.toEqual(codexRuntime);
  });

  test("fails when more than one live workspace runtime matches a repository and kind", async () => {
    const registry = createRuntimeRegistry({
      runtimes: [createRuntime({ runtimeId: "first" }), createRuntime({ runtimeId: "second" })],
    });

    await expect(
      Effect.runPromise(
        registry.findWorkspaceRuntime({ repoPath: "/repo", runtimeKind: "opencode" }),
      ),
    ).rejects.toThrow("Multiple live opencode workspace runtimes found for repo '/repo'.");
  });
});
