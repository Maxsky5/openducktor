import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { RuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createRuntimeOrchestratorCommandHandlers } from "./runtime-orchestrator-command-handlers";

const createRecordingService = () => {
  const calls: Array<{ method: keyof RuntimeOrchestratorService; input: unknown }> = [];
  const service: RuntimeOrchestratorService = {
    async agentSessionStop(input) {
      calls.push({ method: "agentSessionStop", input });
      return { ok: true };
    },
    async runtimeEnsure(input) {
      calls.push({ method: "runtimeEnsure", input });
      return {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
        startedAt: "2026-05-10T10:00:00.000Z",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      };
    },
    async runtimeList(input) {
      calls.push({ method: "runtimeList", input });
      return [];
    },
    async runtimeStop(input) {
      calls.push({ method: "runtimeStop", input });
      return { ok: true };
    },
    async runtimeStartupStatus(input) {
      calls.push({ method: "runtimeStartupStatus", input });
      return {
        runtimeKind: "opencode",
        repoPath: "/repo",
        stage: "idle",
        runtime: null,
        startedAt: null,
        updatedAt: "2026-05-10T10:00:00.000Z",
        elapsedMs: null,
        attempts: null,
        failureKind: null,
        failureReason: null,
        detail: null,
      };
    },
    async repoRuntimeHealth(input) {
      calls.push({ method: "repoRuntimeHealth", input });
      return {
        status: "not_started",
        checkedAt: "2026-05-10T10:00:00.000Z",
        runtime: {
          status: "not_started",
          stage: "idle",
          observation: null,
          instance: null,
          startedAt: null,
          updatedAt: "2026-05-10T10:00:00.000Z",
          elapsedMs: null,
          attempts: null,
          detail: "Runtime has not been started yet.",
          failureKind: null,
          failureReason: null,
        },
        mcp: null,
      };
    },
    async repoRuntimeHealthStatus(input) {
      calls.push({ method: "repoRuntimeHealthStatus", input });
      return {
        status: "not_started",
        checkedAt: "2026-05-10T10:00:00.000Z",
        runtime: {
          status: "not_started",
          stage: "idle",
          observation: null,
          instance: null,
          startedAt: null,
          updatedAt: "2026-05-10T10:00:00.000Z",
          elapsedMs: null,
          attempts: null,
          detail: "Runtime has not been started yet.",
          failureKind: null,
          failureReason: null,
        },
        mcp: null,
      };
    },
  };

  return { calls, service };
};

describe("createRuntimeOrchestratorCommandHandlers", () => {
  test("routes runtime registry commands to the service", async () => {
    const { calls, service } = createRecordingService();
    const router = createHostCommandRouter({
      handlers: createRuntimeOrchestratorCommandHandlers(service),
    });

    await expect(
      router.invoke("agent_session_stop", {
        request: {
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("runtime_ensure", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject({ runtimeId: "runtime-1" });
    await expect(
      router.invoke("runtime_list", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toEqual([]);
    await expect(router.invoke("runtime_stop", { runtimeId: "runtime-1" })).resolves.toEqual({
      ok: true,
    });
    await expect(
      router.invoke("runtime_startup_status", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({ stage: "idle" });
    await expect(
      router.invoke("repo_runtime_health", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({ status: "not_started" });
    await expect(
      router.invoke("repo_runtime_health_status", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({ status: "not_started" });

    expect(calls).toEqual([
      {
        method: "agentSessionStop",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      },
      {
        method: "runtimeEnsure",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      {
        method: "runtimeList",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      { method: "runtimeStop", input: { runtimeId: "runtime-1" } },
      {
        method: "runtimeStartupStatus",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      {
        method: "repoRuntimeHealth",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      {
        method: "repoRuntimeHealthStatus",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
    ]);
  });
});
