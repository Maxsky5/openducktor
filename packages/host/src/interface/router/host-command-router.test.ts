import { Effect } from "effect";
import { taskCardSchema } from "@openducktor/contracts";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "./host-command-router";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createHostCommandRouter", () => {
  test("routes known commands to registered handlers", async () => {
    const router = createHostCommandRouter({
      handlers: {
        workspace_list: (args, context) =>
          Effect.succeed({
            args,
            command: context.command,
          }),
      },
    });
    await expect(router.invoke("workspace_list", { repoPath: "/repo" })).resolves.toEqual({
      args: { repoPath: "/repo" },
      command: "workspace_list",
    });
  });
  test("exposes an Effect-native router surface", async () => {
    const router = createEffectHostCommandRouter({
      handlers: {
        workspace_list: (args, context) =>
          Effect.succeed({
            args,
            command: context.command,
          }),
      },
    });

    await expect(
      Effect.runPromise(router.invoke("workspace_list", { repoPath: "/repo" })),
    ).resolves.toEqual({
      args: { repoPath: "/repo" },
      command: "workspace_list",
    });
  });
  test("preserves valid optional fields in typed handler output", async () => {
    const task = taskCardSchema.parse({
      createdAt: "2026-08-28T00:00:00.000Z",
      id: "task-1",
      issueType: "feature",
      parentId: undefined,
      pullRequest: undefined,
      status: "open",
      targetBranch: undefined,
      title: "Add GitHub login",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    const router = createHostCommandRouter({
      handlers: {
        tasks_list: () => Effect.succeed([task]),
      },
    });

    await expect(router.invoke("tasks_list")).resolves.toEqual([task]);
  });
  test("rejects unknown commands at the transport boundary", async () => {
    const router = createHostCommandRouter({ handlers: {} });
    await expect(router.invoke("workspace_missing")).rejects.toThrow(
      "Unknown OpenDucktor host command: workspace_missing",
    );
  });
  test("rejects known commands without a TypeScript host handler", async () => {
    const router = createHostCommandRouter({ handlers: {} });
    await expect(router.invoke("workspace_list")).rejects.toThrow(
      "OpenDucktor TypeScript host command is not registered: workspace_list",
    );
  });
  test("runs the configured dispose hook", async () => {
    let disposed = false;
    const router = createHostCommandRouter({
      dispose() {
        return Effect.sync(() => {
          disposed = true;
        });
      },
      handlers: {},
    });
    await router.dispose();
    expect(disposed).toBe(true);
  });
});
