import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { filesystemQueryKeys } from "@openducktor/frontend-core/queries/filesystem";
import type { WorktreeRefreshRef } from "./use-forwarded-worktree-refresh";

interface QueryClientRefContract {
  current: QueryClient | null;
}

type RuntimeModule = typeof import("./agents-page-right-panel-runtime");
type RefreshModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh");

let AgentsPageBuildWorktreeRefreshRuntime: RuntimeModule["AgentsPageBuildWorktreeRefreshRuntime"];
let AgentsPageSelectedFileRefreshRuntime: RuntimeModule["AgentsPageSelectedFileRefreshRuntime"];
const realRefreshModule: RefreshModule =
  await import("@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh");
let refreshHookSpy: { mockRestore(): void };
const useBuildWorktreeRefreshMock = mock(
  (_args: Parameters<RefreshModule["useAgentStudioBuildWorktreeRefresh"]>[0]) => {},
);

function SeedQueryData({
  children,
  queryClientRef,
  entries,
}: PropsWithChildren<{
  queryClientRef: { current: QueryClient | null };
  entries: Array<{ queryKey: readonly unknown[]; data: unknown }>;
}>) {
  const queryClient = useQueryClient();
  queryClientRef.current = queryClient;
  for (const entry of entries) {
    if (queryClient.getQueryData(entry.queryKey) === undefined) {
      queryClient.setQueryData(entry.queryKey, entry.data);
    }
  }
  return children;
}

beforeEach(async () => {
  useBuildWorktreeRefreshMock.mockClear();
  refreshHookSpy = spyOn(
    realRefreshModule,
    "useAgentStudioBuildWorktreeRefresh",
  ).mockImplementation(useBuildWorktreeRefreshMock);
  ({ AgentsPageBuildWorktreeRefreshRuntime, AgentsPageSelectedFileRefreshRuntime } =
    await import("./agents-page-right-panel-runtime"));
});

afterEach(() => {
  refreshHookSpy.mockRestore();
});

test("forwards a builder refresh while the right panel is open", async () => {
  const refreshWorktree = mock<NonNullable<WorktreeRefreshRef["current"]>>(async () => {});
  const refreshWorktreeRef: WorktreeRefreshRef = { current: refreshWorktree };
  render(
    <AgentsPageBuildWorktreeRefreshRuntime
      isPanelOpen
      selectedView={{ role: "build", loadedSession: null }}
      refreshWorktreeRef={refreshWorktreeRef}
    />,
  );

  const args = useBuildWorktreeRefreshMock.mock.calls[0]?.[0];
  if (!args) throw new Error("Expected the builder refresh callback");
  expect(args.selectedView).toEqual({ role: "build", loadedSession: null });
  await args.refreshWorktree("soft");
  expect(refreshWorktree).toHaveBeenCalledWith("soft");

  refreshWorktreeRef.current = null;
  expect(await args.refreshWorktree("soft")).toBeUndefined();
  expect(refreshWorktree).toHaveBeenCalledTimes(1);
});

test("invalidates the visible file when the panel is hidden", async () => {
  const queryClientRef: QueryClientRefContract = { current: null };
  const selectedFile = {
    rootPath: "/repo/worktrees/task-1",
    relativePath: "src/index.ts",
  };
  const selectedFileQueryKey = filesystemQueryKeys.textFile(
    selectedFile.rootPath,
    selectedFile.relativePath,
  );
  const unrelatedFileQueryKey = filesystemQueryKeys.textFile("/other-workspace", "src/other.ts");
  render(
    <QueryProvider>
      <SeedQueryData
        queryClientRef={queryClientRef}
        entries={[
          { queryKey: selectedFileQueryKey, data: { content: "before" } },
          { queryKey: unrelatedFileQueryKey, data: { content: "other" } },
        ]}
      >
        <AgentsPageSelectedFileRefreshRuntime
          selectedFile={selectedFile}
          selectedView={{ role: "build", loadedSession: null }}
        />
      </SeedQueryData>
    </QueryProvider>,
  );

  const refreshWorktree = useBuildWorktreeRefreshMock.mock.calls[0]?.[0]?.refreshWorktree;
  expect(refreshWorktree).toBeFunction();
  await refreshWorktree?.("soft");

  expect(queryClientRef.current?.getQueryState(selectedFileQueryKey)?.isInvalidated).toBe(true);
  expect(queryClientRef.current?.getQueryState(unrelatedFileQueryKey)?.isInvalidated).toBe(false);
});
