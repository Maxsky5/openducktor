import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createLiveWorkflowObservations } from "../agent-sessions/live-workflow-observations";
import { createTaskCompletionState } from "./task-completion-state";

test("keeps recovery and retained completion observations separate for identical task paths", async () => {
  const live = createLiveWorkflowObservations();
  const completion = createTaskCompletionState((observation) =>
    Effect.sync(() => live.accept({ type: "task_completion_updated", observation })),
  );
  const first = { workspaceId: "first", repoPath: "/repo", taskId: "same-task" };
  const second = { ...first, workspaceId: "second" };
  const original = completion.ensure(first);
  original.mergeUncertain = true;
  original.deletedBranches = [{ name: "odt/same-task", oid: "a".repeat(40) }];
  original.observation.failure = {
    stage: "merge",
    code: "task_completion_failed",
    message: "The merge outcome is unknown.",
    nextAction: "Inspect the target branch.",
  };
  await Effect.runPromise(completion.publish(original));

  const other = completion.ensure(second);
  expect(other).not.toBe(original);
  expect(other.mergeUncertain).toBeUndefined();
  other.observation.phase = "publishing";
  await Effect.runPromise(completion.publish(other));
  expect(live.snapshot("/repo").taskCompletions.map(({ workspaceId }) => workspaceId)).toEqual([
    first.workspaceId,
    second.workspaceId,
  ]);

  await Effect.runPromise(completion.discard(second));
  expect(completion.ensure(first)).toBe(original);
  expect(original.mergeUncertain).toBe(true);
  expect(original.deletedBranches).toEqual([{ name: "odt/same-task", oid: "a".repeat(40) }]);
  expect(live.snapshot("/repo").taskCompletions).toEqual([original.observation]);
  expect(completion.ensure(second).observation.failure).toBeUndefined();
  expect(completion.ensure({ ...first, repoPath: "/moved/repo" })).not.toBe(original);
});
