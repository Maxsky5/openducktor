import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { enableReactActEnvironment } from "../agent-studio-test-utils";

enableReactActEnvironment();

type RuntimeModule = typeof import("./agents-page-right-panel-runtime");
type RefreshModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh");

let AgentsPageBuildWorktreeRefreshRuntime: RuntimeModule["AgentsPageBuildWorktreeRefreshRuntime"];
let AgentsPageSelectedFileRefreshRuntime: RuntimeModule["AgentsPageSelectedFileRefreshRuntime"];
let realRefreshModule: RefreshModule | null = null;
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
  realRefreshModule =
    await import("@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh");
  mock.module(
    "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh",
    () => ({ useAgentStudioBuildWorktreeRefresh: useBuildWorktreeRefreshMock }),
  );
  ({ AgentsPageBuildWorktreeRefreshRuntime, AgentsPageSelectedFileRefreshRuntime } =
    await import("./agents-page-right-panel-runtime"));
});

afterEach(async () => {
  if (!realRefreshModule) {
    return;
  }
  await restoreMockedModules([
    [
      "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh",
      () => Promise.resolve(realRefreshModule as RefreshModule),
    ],
  ]);
});

test("observes builder mutations while the file explorer tab is active", () => {
  const props = {
    activeTabId: "file_explorer",
    isPanelOpen: true,
    selectedView: { role: "build", loadedSession: null },
    refreshWorktreeRef: { current: async () => {} },
  } satisfies ComponentProps<typeof AgentsPageBuildWorktreeRefreshRuntime>;

  render(<AgentsPageBuildWorktreeRefreshRuntime {...props} />);

  expect(useBuildWorktreeRefreshMock).toHaveBeenCalledWith({
    selectedView: { role: "build", loadedSession: null },
    refreshWorktree: expect.any(Function),
  });
});

test("invalidates the visible file when the panel is hidden", async () => {
  const queryClientRef: { current: QueryClient | null } = { current: null };
  const selectedFile = {
    rootPath: "/repo/worktrees/task-1",
    relativePath: "src/index.ts",
  };
  const selectedFileQueryKey = filesystemQueryKeys.textFile(
    selectedFile.rootPath,
    selectedFile.relativePath,
  );
  const unrelatedFileQueryKey = filesystemQueryKeys.textFile(selectedFile.rootPath, "src/other.ts");
  render(
    <QueryProvider useIsolatedClient>
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
