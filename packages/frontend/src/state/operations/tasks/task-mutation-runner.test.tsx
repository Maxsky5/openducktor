import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { documentQueryKeys } from "@/state/queries/documents";
import { taskQueryKeys } from "@/state/queries/tasks";
import { useTaskMutationRunner } from "./task-mutation-runner";

describe("task mutation runner", () => {
  test("commits once and leaves board and document reconciliation to the event", async () => {
    const run = mock(async (_repo: string) => {});
    const harness = createHookHarness(
      () => ({
        runner: useTaskMutationRunner({ activeRepoPath: "/repo" }),
        queryClient: useQueryClient(),
      }),
      undefined,
      { wrapper: IsolatedQueryWrapper },
    );
    try {
      await harness.mount();
      const { queryClient } = harness.getLatest();
      const taskKey = taskQueryKeys.repoData("/repo");
      const docKey = documentQueryKeys.spec("/repo", "task-1");
      queryClient.setQueryData(taskKey, { tasks: [] });
      queryClient.setQueryData(docKey, { markdown: "# Old", updatedAt: null });
      await harness.run(({ runner }) =>
        runner.runTaskMutation({
          run,
          successDescription: "Saved",
          failureTitle: "Save failed",
        }),
      );
      expect(run.mock.calls).toEqual([["/repo"]]);
      expect(queryClient.getQueryState(taskKey)?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(taskKey)?.error).toBeNull();
      expect(queryClient.getQueryState(docKey)?.isInvalidated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
