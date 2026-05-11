import { createDevServerCommandHandlers } from "./dev-server-command-handlers";
import type { DevServerService } from "./dev-server-service";
import { createHostCommandRouter } from "./host-command-router";

describe("createDevServerCommandHandlers", () => {
  test("routes dev server commands to the service", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const response = {
      repoPath: "/repo",
      taskId: "task-1",
      worktreePath: null,
      scripts: [],
      updatedAt: "2026-05-10T10:00:00.000Z",
    };
    const service: DevServerService = {
      async getState(input) {
        calls.push({ method: "getState", input });
        return response;
      },
      async restart(input) {
        calls.push({ method: "restart", input });
        return response;
      },
      async start(input) {
        calls.push({ method: "start", input });
        return response;
      },
      async stop(input) {
        calls.push({ method: "stop", input });
        return response;
      },
    };
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
});
