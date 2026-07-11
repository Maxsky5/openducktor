import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
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

beforeEach(async () => {
  useBuildWorktreeRefreshMock.mockClear();
  realRefreshModule = await import(
    "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh"
  );
  mock.module(
    "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh",
    () => ({ useAgentStudioBuildWorktreeRefresh: useBuildWorktreeRefreshMock }),
  );
  ({ AgentsPageBuildWorktreeRefreshRuntime, AgentsPageSelectedFileRefreshRuntime } = await import(
    "./agents-page-right-panel-runtime"
  ));
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
  const queryClient = new QueryClient();
  const selectedFile = {
    rootPath: "/repo/worktrees/task-1",
    relativePath: "src/index.ts",
  };
  const selectedFileQueryKey = filesystemQueryKeys.textFile(
    selectedFile.rootPath,
    selectedFile.relativePath,
  );
  const unrelatedFileQueryKey = filesystemQueryKeys.textFile(selectedFile.rootPath, "src/other.ts");
  queryClient.setQueryData(selectedFileQueryKey, { content: "before" });
  queryClient.setQueryData(unrelatedFileQueryKey, { content: "other" });

  render(
    <QueryClientProvider client={queryClient}>
      <AgentsPageSelectedFileRefreshRuntime
        selectedFile={selectedFile}
        selectedView={{ role: "build", loadedSession: null }}
      />
    </QueryClientProvider>,
  );

  const refreshWorktree = useBuildWorktreeRefreshMock.mock.calls[0]?.[0]?.refreshWorktree;
  expect(refreshWorktree).toBeFunction();
  await refreshWorktree?.("soft");

  expect(queryClient.getQueryState(selectedFileQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(unrelatedFileQueryKey)?.isInvalidated).toBe(false);
});
