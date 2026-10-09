import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type RepoAction } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalCommandService } from "../terminals/terminal-command";
import { actionCommandLines } from "./repo-action-command";
import { createRepoActionService } from "./repo-action-service";

const action = (overrides: Partial<RepoAction> = {}): RepoAction => ({
  id: "checks",
  icon: "play",
  name: "Checks",
  command: "bun test",
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
  ...overrides,
});

const request = {
  workingDir: "/repo",
  context: { repoPath: "/repo", taskId: "task-1" },
  actionId: "checks",
};

const makeService = (actions: RepoAction[]) => {
  const started: Array<Parameters<TerminalCommandService["startCommand"]>[0]> = [];
  const service = createRepoActionService({
    settings: {
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "workspace-1",
            workspaceName: "Workspace",
            repoPath: "/repo",
            actions: { items: actions, defaultActionId: actions[0]?.id ?? null },
          }),
        ),
    },
    terminals: {
      startCommand: (input) =>
        Effect.sync(() => {
          started.push(input);
          const summary = {
            terminalId: "terminal-1",
            label: input.label,
            context: input.context,
            initialWorkingDir: input.workingDir,
            createdAt: "2026-07-12T00:00:00.000Z",
            lifecycle: "running" as const,
            exit: null,
            startedBy: input.startedBy,
          };
          return {
            response: { ref: { terminalId: "terminal-1" }, summary },
            result: Effect.never,
          };
        }),
    },
  });
  return { service, started };
};

describe("actionCommandLines", () => {
  test("keeps each non-blank line without its outer spaces and skips comment lines", async () => {
    expect(
      await Effect.runPromise(
        actionCommandLines(action({ command: "# setup\r\nbun install\n\n  bun test  \n  # end" })),
      ),
    ).toEqual(["bun install", "bun test"]);
  });

  test("fails when the command has only comment or blank lines", async () => {
    expect(
      await Effect.runPromise(Effect.flip(actionCommandLines(action({ command: "# later\n\n" })))),
    ).toMatchObject({
      _tag: "RepoActionHasNoCommandError",
      actionName: "Checks",
      message: 'Action "Checks" has no command to run. Lines that start with # are comments.',
    });
  });
});

describe("createRepoActionService", () => {
  test("runs a saved action in a terminal that continues as a shell under the action name", async () => {
    const { service, started } = makeService([action({ command: "bun install\nbun test" })]);

    const response = await Effect.runPromise(service.run(request));

    expect(response.summary.label).toBe("Checks");
    expect(started).toEqual([
      {
        context: request.context,
        workingDir: "/repo",
        label: "Checks",
        commandLines: ["bun install", "bun test"],
        startedBy: "user",
      },
    ]);
  });

  test("fails without a terminal when the repository settings no longer contain the action", async () => {
    const { service, started } = makeService([action({ id: "dev" })]);

    expect(await Effect.runPromise(Effect.flip(service.run(request)))).toMatchObject({
      _tag: "RepoActionNotFoundError",
      actionId: "checks",
      repoPath: "/repo",
    });
    expect(started).toEqual([]);
  });
});
