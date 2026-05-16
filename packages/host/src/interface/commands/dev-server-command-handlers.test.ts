import { Effect } from "effect";
import type { DevServerService } from "../../application/dev-servers/dev-server-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createDevServerCommandHandlers } from "./dev-server-command-handlers";

const createDevServerServiceFake = (service: DevServerService): DevServerService =>
  service as DevServerService;
describe("createDevServerCommandHandlers", () => {
  test("routes dev server commands to the service", async () => {
    const calls: Array<{
      method: string;
      input: unknown;
    }> = [];
    const response = {
      repoPath: "/repo",
      taskId: "task-1",
      worktreePath: null,
      scripts: [],
      updatedAt: "2026-05-10T10:00:00.000Z",
    };
    const service = createDevServerServiceFake({
      getState(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "getState", input });
            return response;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      restart(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "restart", input });
            return response;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      start(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "start", input });
            return response;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stop(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "stop", input });
            return response;
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
    const router = createHostCommandRouter({
      handlers: createDevServerCommandHandlers(service),
    });
    await expect(
      router.invoke("dev_server_get_state", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      taskId: "task-1",
    });
    await router.invoke("dev_server_start", { repoPath: "/repo", taskId: "task-1" });
    await router.invoke("dev_server_stop", { repoPath: "/repo", taskId: "task-1" });
    await router.invoke("dev_server_restart", { repoPath: "/repo", taskId: "task-1" });
    expect(calls).toEqual([
      { method: "getState", input: { repoPath: "/repo", taskId: "task-1" } },
      { method: "start", input: { repoPath: "/repo", taskId: "task-1" } },
      { method: "stop", input: { repoPath: "/repo", taskId: "task-1" } },
      { method: "restart", input: { repoPath: "/repo", taskId: "task-1" } },
    ]);
  });
  test("rejects malformed command inputs before calling the service", async () => {
    const calls: unknown[] = [];
    const service = createDevServerServiceFake({
      getState(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      restart(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      start(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stop(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
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
    const router = createHostCommandRouter({
      handlers: createDevServerCommandHandlers(service),
    });
    await expect(router.invoke("dev_server_get_state", { repoPath: "/repo" })).rejects.toThrow(
      "taskId is required.",
    );
    await expect(router.invoke("dev_server_get_state")).rejects.toThrow(
      "dev_server_get_state input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});
