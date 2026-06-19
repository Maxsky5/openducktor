import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import type { RuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { HostOperationError } from "../../effect/host-errors";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createRuntimeOrchestratorCommandHandlers } from "./runtime-orchestrator-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const createRuntimeOrchestratorServiceFake = (
  service: RuntimeOrchestratorService,
): RuntimeOrchestratorService => service as RuntimeOrchestratorService;
const createRecordingService = () => {
  const calls: Array<{
    method: keyof RuntimeOrchestratorService;
    input: unknown;
  }> = [];
  const service = createRuntimeOrchestratorServiceFake({
    agentSessionStop(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "agentSessionStop", input });
          return { ok: true };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    runtimeEnsure(input) {
      return Effect.tryPromise({
        try: async () => {
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
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    runtimeRequire(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "runtimeRequire", input });
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
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    runtimeList(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "runtimeList", input });
          return [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    runtimeStop(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "runtimeStop", input });
          return { ok: true };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    repoRuntimeHealth(input) {
      return Effect.tryPromise({
        try: async () => {
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
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  });
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
      router.invoke("runtime_require", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject({ runtimeId: "runtime-1" });
    await expect(
      router.invoke("runtime_list", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toEqual([]);
    await expect(router.invoke("runtime_stop", { runtimeId: "runtime-1" })).resolves.toEqual({
      ok: true,
    });
    await expect(
      router.invoke("repo_runtime_health", {
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
        method: "runtimeRequire",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      {
        method: "runtimeList",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
      { method: "runtimeStop", input: { runtimeId: "runtime-1" } },
      {
        method: "repoRuntimeHealth",
        input: { runtimeKind: "opencode", repoPath: "/repo" },
      },
    ]);
  });
});
