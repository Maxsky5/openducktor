import { describe, expect, mock, test } from "bun:test";
import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createSystemDiagnosticsCommandHandlers } from "./system-diagnostics-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const pathCheckResult = { ok: true, error: null } satisfies PathCheck;
const gitCheckResult = {
  ok: true,
  executablePath: "/bin/git",
  version: "git version 2.50.0",
  error: null,
} satisfies GitCheck;

const taskStoreCheckResult = {
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: null,
    databasePath: "/repo/.openducktor/tasks.db",
  },
  taskStoreOk: true,
  taskStorePath: "/repo/.openducktor/tasks.db",
  taskStoreError: null,
} satisfies TaskStoreCheck;

const createDiagnosticsService = () => {
  const pathCheck = mock((_forceRefresh?: boolean) => Effect.succeed(pathCheckResult));
  const gitCheck = mock(() => Effect.succeed(gitCheckResult));
  const taskStoreCheck = mock((_repoPath: string) => Effect.succeed(taskStoreCheckResult));
  const service = { pathCheck, gitCheck, taskStoreCheck } satisfies SystemDiagnosticsService;
  return { service, pathCheck, gitCheck, taskStoreCheck };
};
describe("createSystemDiagnosticsCommandHandlers", () => {
  test("routes diagnostics commands to the service", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service),
    });
    await expect(router.invoke("path_check", { force: true })).resolves.toEqual(pathCheckResult);
    await expect(router.invoke("task_store_check", { repoPath: "/repo" })).resolves.toEqual(
      taskStoreCheckResult,
    );
    await expect(router.invoke("git_check", {})).resolves.toEqual(gitCheckResult);
    expect(diagnostics.pathCheck).toHaveBeenCalledWith(true);
    expect(diagnostics.taskStoreCheck).toHaveBeenCalledWith("/repo");
    expect(diagnostics.gitCheck).toHaveBeenCalledWith();
  });
  test("requires repoPath for repo-scoped diagnostics", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service),
    });
    await expect(router.invoke("task_store_check", {})).rejects.toThrow("repoPath is required.");
    await expect(router.invoke("path_check", { force: "true" })).rejects.toThrow(
      "path_check force must be a boolean when provided.",
    );
  });
});
