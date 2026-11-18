import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createTaskCardFixture } from "../test-support/shared-test-fixtures";
import { useTaskWorkflowContextQuery } from "./task-workflow-context";
import { taskQueryKeys } from "./tasks";

test("keeps the same task unavailable error across renders after deletion", async () => {
  const scope = { workspaceId: "workspace-1", repoPath: "/repo" };
  const task = createTaskCardFixture({ id: "task-1" });
  const queryClient = new QueryClient();
  const queryKey = taskQueryKeys.unfilteredRepoData(scope);
  queryClient.setQueryData(queryKey, { tasks: [task] });
  const context = renderHook(
    () => {
      const { data, error } = useTaskWorkflowContextQuery({ ...scope }, task.id, true);
      return { data, error };
    },
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  try {
    expect(context.result.current.data?.id).toBe(task.id);
    act(() => queryClient.setQueryData(queryKey, { tasks: [] }));
    await waitFor(
      () => expect(context.result.current.error?.message).toMatch(/^Task "task-1" is unavailable/),
      { timeout: 400 },
    );
    const unavailable = context.result.current.error;
    expect(context.result.current.data).toBeUndefined();
    context.rerender();
    expect(context.result.current.error).toBe(unavailable);
  } finally {
    context.unmount();
    queryClient.clear();
  }
});
