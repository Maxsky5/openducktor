import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import {
  createDirectMergeDevServerService,
  createTaskService,
  task,
} from "./test-support/task-workflow-harness";

describe("blocker and approval concurrency", () => {
  test.each(["blocker writing", "approval cleaning", "approval awaiting lock"] as const)(
    "preserves the winning operation while %s",
    async (scenario) => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const pause = Deferred.succeed(entered, undefined).pipe(
              Effect.zipRight(Deferred.await(release)),
            );
            let current = task({ status: "human_review" });
            let canonicalizeCalls = 0;
            let cleanups = 0;
            const writes: string[] = [];
            const service = createTaskService({
              gitPort: createGitPortTestDouble({
                canonicalizePath: (path) =>
                  Effect.gen(function* () {
                    canonicalizeCalls += 1;
                    if (scenario === "approval awaiting lock" && canonicalizeCalls === 1)
                      yield* pause;
                    return path;
                  }),
              }),
              devServerService: createDirectMergeDevServerService([]),
              terminalService: {
                acquireTaskCleanup: () =>
                  Effect.gen(function* () {
                    cleanups += 1;
                    if (scenario === "approval cleaning") yield* pause;
                    return { closedTerminalIds: [] };
                  }),
              },
              taskStore: {
                listTasks: () => Effect.sync(() => [current]),
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
            const approve = service.humanApprove(input);
            const first = yield* Effect.forkScoped(
              Effect.either(scenario === "blocker writing" ? block : approve),
            );
            yield* Deferred.await(entered);
            const second = yield* Effect.either(scenario === "blocker writing" ? approve : block);
            yield* Deferred.succeed(release, undefined);
            const firstResult = yield* Fiber.join(first);
            return { firstResult, second, current, cleanups, writes };
          }),
        ),
      );
      if (scenario === "approval awaiting lock") {
        expect(result.firstResult._tag).toBe("Left");
        expect(result.second._tag).toBe("Right");
      } else {
        expect(result.firstResult._tag).toBe("Right");
        expect(result.second._tag).toBe("Left");
      }
      const approved = scenario === "approval cleaning";
      expect(result.current.status).toBe(approved ? "closed" : "blocked");
      expect(result.writes).toEqual([approved ? "closed" : "blocked"]);
      expect(result.cleanups).toBe(approved ? 1 : 0);
    },
  );
});
