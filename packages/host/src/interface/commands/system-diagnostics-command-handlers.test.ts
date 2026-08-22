import { createFocusedTestService } from "../../test-support/focused-service";
import { describe, expect, mock, test } from "bun:test";
import type { RuntimeCheck, SystemCheck, TaskStoreCheck } from "@openducktor/contracts";
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

const runtimeCheckResult = {
  gitOk: true,
  gitVersion: "2.50.0",
  ghOk: true,
  ghVersion: "2.75.0",
  ghAuthOk: true,
  ghAuthLogin: "octocat",
  ghAuthError: null,
  runtimes: [],
  errors: [],
} satisfies RuntimeCheck;

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

const systemCheckResult = {
  ...runtimeCheckResult,
  ...taskStoreCheckResult,
} satisfies SystemCheck;

const createDiagnosticsService = () => {
  const runtimeCheck = mock((_forceRefresh?: boolean) => Effect.succeed(runtimeCheckResult));
  const taskStoreCheck = mock((_repoPath: string) => Effect.succeed(taskStoreCheckResult));
  const systemCheck = mock((_repoPath: string) => Effect.succeed(systemCheckResult));
  const service = createFocusedTestService<SystemDiagnosticsService>({
    runtimeCheck,
    taskStoreCheck,
    systemCheck,
  });
  return { runtimeCheck, service, systemCheck, taskStoreCheck };
};
describe("createSystemDiagnosticsCommandHandlers", () => {
  test("routes diagnostics commands to the service", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service),
    });
    await expect(router.invoke("runtime_check", { force: true })).resolves.toEqual(
      runtimeCheckResult,
    );
    await expect(router.invoke("task_store_check", { repoPath: "/repo" })).resolves.toEqual(
      taskStoreCheckResult,
    );
    await expect(router.invoke("system_check", { repoPath: "/repo" })).resolves.toEqual(
      systemCheckResult,
    );
    expect(diagnostics.runtimeCheck).toHaveBeenCalledWith(true);
    expect(diagnostics.taskStoreCheck).toHaveBeenCalledWith("/repo");
    expect(diagnostics.systemCheck).toHaveBeenCalledWith("/repo");
  });
  test("requires repoPath for repo-scoped diagnostics", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service),
    });
    await expect(router.invoke("task_store_check", {})).rejects.toThrow("repoPath is required.");
    await expect(router.invoke("system_check")).rejects.toThrow(
      "system_check input must be an object.",
    );
  });
});
