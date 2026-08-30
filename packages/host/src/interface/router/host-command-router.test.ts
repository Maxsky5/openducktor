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
    let receivedArgs: Parameters<
      NonNullable<CreateHostCommandRouterInput["handlers"]["system_get_platform"]>
    >[0];
    const router = createHostCommandRouter({
      handlers: {
        system_get_platform: (args) => {
          receivedArgs = args;
          return Effect.succeed("linux");
        },
      },
    });
    await expect(router.invoke("system_get_platform", { repoPath: "/repo" })).resolves.toBe(
      "linux",
    );
    expect(receivedArgs).toEqual({ repoPath: "/repo" });
  });
  test("exposes an Effect-native router surface", async () => {
    let receivedArgs: Parameters<
      NonNullable<CreateHostCommandRouterInput["handlers"]["system_get_platform"]>
    >[0];
    const router = createEffectHostCommandRouter({
      handlers: {
        system_get_platform: (args) => {
          receivedArgs = args;
          return Effect.succeed("linux");
        },
      },
    });

    await expect(
      Effect.runPromise(router.invoke("system_get_platform", { repoPath: "/repo" })),
    ).resolves.toBe("linux");
    expect(receivedArgs).toEqual({ repoPath: "/repo" });
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
