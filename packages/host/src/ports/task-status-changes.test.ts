import { expect, test } from "bun:test";
import type { TaskCard, TaskStatus } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { collectTaskStatusChanges, recordCommittedTaskStatusChange } from "./task-status-changes";

const record = (id: string, status: TaskStatus, previousStatus: TaskStatus) =>
  // SAFETY: The recorder reads only id, title, and status.
  recordCommittedTaskStatusChange({ task: { id, title: id, status } as TaskCard, previousStatus });

test("each concurrent mutation collects only its own committed transitions", async () => {
  const firstRecorded = Deferred.makeUnsafe<void>();
  const first = collectTaskStatusChanges(
    record("first", "in_progress", "open").pipe(
      Effect.andThen(Deferred.succeed(firstRecorded, undefined)),
      Effect.andThen(record("first", "ai_review", "in_progress")),
    ),
  );
  const second = collectTaskStatusChanges(
    Deferred.await(firstRecorded).pipe(Effect.andThen(record("second", "blocked", "open"))),
  );

  const [firstResult, secondResult] = await Effect.runPromise(
    Effect.all([first, second], { concurrency: "unbounded" }),
  );

  expect(firstResult.statusChanges.map(({ task }) => [task.id, task.status])).toEqual([
    ["first", "in_progress"],
    ["first", "ai_review"],
  ]);
  expect(secondResult.statusChanges.map(({ task }) => [task.id, task.status])).toEqual([
    ["second", "blocked"],
  ]);
});

test("reports each committed transition at its commit, also when the caller is interrupted", async () => {
  const committed: string[] = [];
  const recorded = Deferred.makeUnsafe<void>();
  const mutation = collectTaskStatusChanges(
    record("task", "ai_review", "in_progress").pipe(
      Effect.andThen(Deferred.succeed(recorded, undefined)),
      Effect.andThen(Effect.never),
    ),
    ({ task }) => committed.push(task.status),
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(mutation);
      yield* Deferred.await(recorded);
      expect(committed).toEqual(["ai_review"]);
      yield* Fiber.interrupt(fiber);
    }),
  );

  expect(committed).toEqual(["ai_review"]);
});

test("a failed mutation keeps the transitions it committed before the failure", async () => {
  const collected = await Effect.runPromise(
    collectTaskStatusChanges(
      record("task", "in_progress", "open").pipe(Effect.andThen(Effect.fail("write failed"))),
    ),
  );

  expect(collected.result._tag).toBe("Failure");
  expect(collected.statusChanges).toHaveLength(1);
});
