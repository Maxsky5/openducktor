import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { enableReactActEnvironment } from "../agent-studio-test-utils";

enableReactActEnvironment();

type RuntimeModule = typeof import("./agents-page-right-panel-runtime");
type RefreshModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh");

let AgentsPageBuildWorktreeRefreshRuntime: RuntimeModule["AgentsPageBuildWorktreeRefreshRuntime"];
let realRefreshModule: RefreshModule | null = null;
const useBuildWorktreeRefreshMock = mock(() => {});

beforeEach(async () => {
  useBuildWorktreeRefreshMock.mockClear();
  realRefreshModule = await import(
    "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh"
  );
  mock.module(
    "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh",
    () => ({ useAgentStudioBuildWorktreeRefresh: useBuildWorktreeRefreshMock }),
  );
  ({ AgentsPageBuildWorktreeRefreshRuntime } = await import("./agents-page-right-panel-runtime"));
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
