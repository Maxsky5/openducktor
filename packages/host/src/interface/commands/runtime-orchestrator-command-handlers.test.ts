import { describe, expect, test } from "bun:test";
import {
  type HostRuntimeSnapshot,
  type HostRuntimeStatus,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
  type RuntimeLifecycleImpact,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { RuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { createHostRuntimeServiceTestDouble } from "../../test-support/host-runtime-service-test-double";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createRuntimeOrchestratorCommandHandlers } from "./runtime-orchestrator-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const runtime = {
  kind: "opencode",
  runtimeId: "runtime-1",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-10-03T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
} satisfies RuntimeInstanceSummary;

const status = {
  kind: "opencode",
  enabled: true,
  configuredExecutablePath: "opencode",
  effectiveExecutablePath: "/bin/opencode",
  version: null,
  state: "ready",
  trigger: "host_startup",
  runtimeId: "runtime-1",
  startedAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
  failure: null,
  revision: 1,
} satisfies HostRuntimeStatus;

const snapshot = { hostInstanceId: "host-1", runtimes: [status] } satisfies HostRuntimeSnapshot;

const impact = {
  kinds: [
    {
      kind: "opencode",
      runtimeId: "runtime-1",
      effect: "restart",
      oldExecutablePath: "opencode",
      newExecutablePath: "opencode",
    },
  ],
  workspaces: [],
  confirmation: "confirmation-1",
} satisfies RuntimeLifecycleImpact;

const createHarness = () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const orchestrator: RuntimeOrchestratorService = {
    agentSessionStop: (input) =>
      Effect.sync(() => {
        calls.push({ method: "agentSessionStop", input });
        return { ok: true };
      }),
  };
  const hostRuntimeService = createHostRuntimeServiceTestDouble({
    snapshot: () =>
      Effect.sync(() => {
        calls.push({ method: "snapshot", input: null });
        return snapshot;
      }),
    requireRuntime: (kind) =>
      Effect.sync(() => {
        calls.push({ method: "requireRuntime", input: kind });
        return runtime;
      }),
    restartImpact: (kind) =>
      Effect.sync(() => {
        calls.push({ method: "restartImpact", input: kind });
        return impact;
      }),
    restart: (kind, confirmation) =>
      Effect.sync(() => {
        calls.push({ method: "restart", input: { kind, confirmation } });
        return { type: "completed" as const, status };
      }),
  });
  const router = createHostCommandRouter({
    handlers: createRuntimeOrchestratorCommandHandlers(orchestrator, hostRuntimeService),
  });
  return { calls, router };
};

describe("createRuntimeOrchestratorCommandHandlers", () => {
  test("routes session stop and host runtime lifecycle commands", async () => {
    const { calls, router } = createHarness();
    const stopRequest = {
      repoPath: "/repo",
      taskId: "task-1",
      externalSessionId: "external-session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    };
    await expect(router.invoke("agent_session_stop", { request: stopRequest })).resolves.toEqual({
      ok: true,
    });
    await expect(router.invoke("runtime_status")).resolves.toEqual(snapshot);
    await expect(router.invoke("runtime_require", { runtimeKind: "opencode" })).resolves.toEqual(
      runtime,
    );
    await expect(
      router.invoke("runtime_restart_impact", { runtimeKind: "opencode" }),
    ).resolves.toEqual(impact);
    await expect(
      router.invoke("runtime_restart", {
        runtimeKind: "opencode",
        confirmation: "confirmation-1",
      }),
    ).resolves.toEqual({ type: "completed", status });
    expect(calls).toEqual([
      { method: "agentSessionStop", input: stopRequest },
      { method: "snapshot", input: null },
      { method: "requireRuntime", input: "opencode" },
      { method: "restartImpact", input: "opencode" },
      { method: "restart", input: { kind: "opencode", confirmation: "confirmation-1" } },
    ]);
  });

  test("rejects invalid lifecycle input before it reaches the service", async () => {
    const { calls, router } = createHarness();
    await expect(
      router.invoke("runtime_require", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).rejects.toThrow("runtime_require input is invalid");
    await expect(router.invoke("runtime_restart_impact", { runtimeKind: "other" })).rejects.toThrow(
      "runtime_restart_impact input is invalid",
    );
    await expect(router.invoke("runtime_restart", { runtimeKind: "opencode" })).rejects.toThrow(
      "runtime_restart input is invalid",
    );
    await expect(
      router.invoke("runtime_restart", { runtimeKind: "opencode", confirmation: " " }),
    ).rejects.toThrow("runtime_restart input is invalid");
    expect(calls).toEqual([]);
  });
});
