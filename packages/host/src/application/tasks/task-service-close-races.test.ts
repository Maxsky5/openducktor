import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type { RepoConfig } from "@openducktor/contracts";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createTaskService, task } from "./test-support/task-workflow-harness";

const repoConfig: RepoConfig = {
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  worktreeBasePath: "/worktrees/repo",
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};

describe("blocker and close concurrency", () => {
  test.each(["blocker writing", "close cleaning", "close awaiting lock"] as const)(
    "preserves the winning operation while %s",
    async (scenario) => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const pause = Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            );
            let current = task({ status: "human_review" });
            let canonicalizeCalls = 0;
            let cleanups = 0;
            const writes: string[] = [];
            const service = createTaskService({
              taskWorkflows: builtinTaskWorkflows,
              gitPort: createGitPortTestDouble({
                canonicalizePath: (path) =>
                  Effect.gen(function* () {
                    canonicalizeCalls += 1;
                    if (scenario === "close awaiting lock" && canonicalizeCalls === 1) yield* pause;
                    return path;
                  }),
              }),
              settingsConfig: createSettingsConfigTestDouble({
                resolveConfiguredPath: (path: string) => path,
                join: (...paths: string[]) => paths.join("/"),
              }),
              workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
                getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
              }),
              terminalService: {
                acquireTaskCleanup: () =>
                  Effect.gen(function* () {
                    cleanups += 1;
                    if (scenario === "close cleaning") yield* pause;
                    return { closedTerminalIds: [] };
                  }),
              },
              taskStore: {
                listTasks: () => Effect.sync(() => [current]),
                getTaskMetadata: () => Effect.succeed({ artifacts: {}, agentSessions: [] }),
                transitionTask: (input) =>
                  Effect.gen(function* () {
                    if (scenario === "blocker writing" && input.status === "blocked") yield* pause;
                    writes.push(input.status);
                    current = { ...current, status: input.status };
                    return current;
                  }),
              },
            });
            const input = { repoPath: "/repo", taskId: current.id };
            const block = service.buildBlocked({ ...input, reason: "Needs clarification" });
            const close = service.closeTask({ ...input, removeWorktree: false });
            const first = yield* Effect.forkScoped(
              Effect.result(scenario === "blocker writing" ? block : close),
            );
            yield* Deferred.await(entered);
            const second = yield* Effect.result(scenario === "blocker writing" ? close : block);
            yield* Deferred.succeed(release, undefined);
            const firstResult = yield* Fiber.join(first);
            return { firstResult, second, current, cleanups, writes };
          }),
        ),
      );
      // Close can close a blocked task, so a close that waits for the lock still succeeds.
      const outcomes = {
        "blocker writing": {
          first: "Success",
          second: "Failure",
          writes: ["blocked"],
          status: "blocked",
        },
        "close cleaning": {
          first: "Success",
          second: "Failure",
          writes: ["closed"],
          status: "closed",
        },
        "close awaiting lock": {
          first: "Success",
          second: "Success",
          writes: ["blocked", "closed"],
          status: "closed",
        },
      } satisfies Record<
        typeof scenario,
        {
          first: "Success" | "Failure";
          second: "Success" | "Failure";
          writes: string[];
          status: string;
        }
      >;
      const expected = outcomes[scenario];
      expect(result.firstResult._tag).toBe(expected.first);
      expect(result.second._tag).toBe(expected.second);
      expect(result.writes).toEqual(expected.writes);
      expect(result.current.status).toBe(expected.status);
      expect(result.cleanups).toBe(expected.status === "closed" ? 1 : 0);
    },
  );
});
