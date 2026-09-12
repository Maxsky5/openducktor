import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeQueryError } from "../../ports/runtime-query-error";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createAgentRuntimeQueryService } from "./agent-runtime-query-service";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const historyHarness = async (
  rootKind: "default" | "configured" | "legacy" | "outside" = "default",
) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "runtime-query-history-")));
  temporaryRoots.push(root);
  const repoPath = path.join(root, "repo");
  await mkdir(repoPath);
  const settingsConfig = createSettingsConfigAdapter({
    configPath: path.join(root, "settings.json"),
  });
  const managedRoot =
    rootKind === "legacy"
      ? settingsConfig.defaultRepoWorktreeBasePath(repoPath)
      : rootKind === "default"
        ? settingsConfig.defaultWorktreeBasePath("workspace")
        : path.join(root, rootKind);
  const workingDirectory = path.join(managedRoot, "task");
  await mkdir(workingDirectory, { recursive: true });
  const input = {
    repoPath,
    runtimeKind: "codex",
    runtimePolicy: {
      kind: "codex",
      policy: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        commandNetworkAccess: false,
        approvalsReviewerApplies: true,
      },
    },
    workingDirectory,
    externalSessionId: "saved-session",
    sessionScope: { kind: "workflow", taskId: "task", role: "build" },
  } as const;
  const runtime: RuntimeInstanceSummary = {
    runtimeId: "runtime-1",
    kind: "codex",
    repoPath,
    workingDirectory: repoPath,
    taskId: null,
    role: "workspace",
    runtimeRoute: { type: "host_service", identity: "runtime-1" },
    startedAt: "2026-09-12T10:00:00.000Z",
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
  };
  const calls: unknown[] = [];
  const adapterRegistry = createLiveSessionAdapterRegistry();
  await Effect.runPromise(
    adapterRegistry.register(
      createAgentSessionRuntimeAdapterTestDouble(
        { repoPath, runtimeKind: "codex", runtimeId: runtime.runtimeId },
        {
          readSnapshot: (ref) => Effect.succeed({ type: "missing", ref }),
          queries: {
            ...unexpectedRuntimeQueries,
            resolveSessionParent: () => Effect.succeed(null),
            loadSessionHistory: (request) =>
              Effect.sync(() => {
                calls.push(request);
                return [];
              }),
          },
        },
      ),
    ),
  );
  const dependencies = {
    adapterRegistry,
    runtimeRegistry: { findWorkspaceRuntime: () => Effect.succeed(runtime) },
    gitPort: {
      canonicalizePath: settingsConfig.canonicalizePath,
      isGitRepository: () => Effect.succeed(true),
    },
    settingsConfig,
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "workspace",
            workspaceName: "Workspace",
            repoPath,
            defaultRuntimeKind: "codex",
            worktreeBasePath: rootKind === "configured" ? managedRoot : undefined,
          }),
        ),
    }),
    taskReader: {
      getTaskMetadata: ({ taskId }: { taskId: string }) =>
        Effect.succeed({
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions:
            taskId === "task"
              ? [
                  {
                    externalSessionId: input.externalSessionId,
                    runtimeKind: input.runtimeKind,
                    workingDirectory,
                    role: "build" as const,
                    startedAt: runtime.startedAt,
                    selectedModel: null,
                  },
                ]
              : [],
        }),
    },
    worktreeReads: createTaskSessionLifecycleCoordinator(),
    worktreeFiles: createWorktreeFileAdapter(),
  };
  return {
    root,
    managedRoot,
    input,
    dependencies,
    calls,
    service: createAgentRuntimeQueryService(dependencies),
  };
};

for (const rootKind of ["default", "configured", "legacy"] as const) {
  test(`reads owned history after removal of the ${rootKind} worktree root`, async () => {
    const h = await historyHarness(rootKind);
    await rm(h.managedRoot, { recursive: true });
    expect(await Effect.runPromise(h.service.loadSessionHistory(h.input))).toEqual([]);
    expect(h.calls).toEqual([h.input]);
  });
}

test("checks task, role, session, and directory ownership before reading removed-worktree history", async () => {
  const h = await historyHarness();
  await rm(h.managedRoot, { recursive: true });
  for (const request of [
    { ...h.input, externalSessionId: "unowned-session" },
    { ...h.input, sessionScope: { ...h.input.sessionScope, taskId: "other-task" } },
    { ...h.input, sessionScope: { ...h.input.sessionScope, role: "qa" as const } },
    { ...h.input, workingDirectory: path.join(h.managedRoot, "other-task") },
    { ...h.input, sessionScope: undefined },
  ]) {
    const failure = await Effect.runPromise(Effect.flip(h.service.loadSessionHistory(request)));
    expect(failure.failure.code).toBe("scope_mismatch");
  }
  expect(h.calls).toEqual([]);
});

test("rejects a recorded session outside the managed worktree roots", async () => {
  const h = await historyHarness("outside");
  await rm(h.managedRoot, { recursive: true });
  const failure = await Effect.runPromise(Effect.flip(h.service.loadSessionHistory(h.input)));
  expect(failure.failure.code).toBe("scope_mismatch");
  expect(h.calls).toEqual([]);
});

test("rejects a symlink in the removed session directory", async () => {
  const h = await historyHarness();
  await rm(h.input.workingDirectory, { recursive: true });
  await symlink(path.join(h.root, "missing-external-directory"), h.input.workingDirectory);
  const failure = await Effect.runPromise(Effect.flip(h.service.loadSessionHistory(h.input)));
  expect(failure.failure.code).toBe("scope_mismatch");
  expect(h.calls).toEqual([]);
});

test("keeps file search, session diff, file status, and todos strict after worktree removal", async () => {
  const h = await historyHarness();
  await rm(h.input.workingDirectory, { recursive: true });
  const queries: Effect.Effect<unknown, RuntimeQueryError>[] = [
    h.service.searchFiles({ ...h.input, query: "src" }),
    h.service.loadSessionDiff(h.input),
    h.service.loadFileStatus(h.input),
    h.service.loadSessionTodos(h.input),
  ];
  for (const query of queries) {
    const failure = await Effect.runPromise(Effect.flip(query));
    expect(failure.failure.code).toBe("scope_mismatch");
  }
  expect(h.calls).toEqual([]);
});

for (const code of ["EACCES", "EIO", "ENOTDIR"]) {
  test(`preserves ${code} when reading a recorded session directory`, async () => {
    const h = await historyHarness();
    const error = new HostOperationError({
      operation: "settingsConfig.canonicalizePath",
      message: "Cannot resolve the session directory",
      cause: Object.assign(new Error(code), { code }),
    });
    const service = createAgentRuntimeQueryService({
      ...h.dependencies,
      settingsConfig: {
        ...h.dependencies.settingsConfig,
        canonicalizePath: (inputPath) =>
          inputPath === h.input.workingDirectory
            ? Effect.fail(error)
            : h.dependencies.settingsConfig.canonicalizePath(inputPath),
      },
    });
    const failure = await Effect.runPromise(Effect.flip(service.loadSessionHistory(h.input)));
    expect(failure.failure.code).toBe("scope_mismatch");
    expect(failure.cause).toBe(error);
    expect(h.calls).toEqual([]);
  });
}

test("propagates path resolution failures from the managed worktree root", async () => {
  const h = await historyHarness();
  await rm(h.managedRoot, { recursive: true });
  const error = new HostOperationError({
    operation: "worktreeFile.resolvePathWithinRoot",
    message: "Cannot resolve the managed worktree root",
    cause: Object.assign(new Error("Access denied"), { code: "EACCES" }),
  });
  const service = createAgentRuntimeQueryService({
    ...h.dependencies,
    worktreeFiles: { resolvePathWithinRoot: () => Effect.fail(error) },
  });
  const failure = await Effect.runPromise(Effect.flip(service.loadSessionHistory(h.input)));
  expect(failure.failure.code).toBe("scope_mismatch");
  expect(failure.cause).toBe(error);
  expect(h.calls).toEqual([]);
});

test("rejects removed-worktree history when the repository is also missing", async () => {
  const h = await historyHarness();
  await rm(h.input.workingDirectory, { recursive: true });
  await rm(h.input.repoPath, { recursive: true });
  const failure = await Effect.runPromise(Effect.flip(h.service.loadSessionHistory(h.input)));
  expect(failure.failure.code).toBe("scope_mismatch");
  expect(h.calls).toEqual([]);
});
