import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createHookHarness, enableReactActEnvironment } from "../agent-studio-test-utils";
import {
  createBuildToolsSnapshotFixture,
  createGitActionsFixture,
} from "./agents-page-build-tools.test-support";

enableReactActEnvironment();

type BuildToolsSnapshotModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot");
type GitActionsModule = typeof import("../use-agent-studio-git-actions");
type BuildToolsModule = typeof import("./use-agents-page-build-tools");
type HookArgs = Parameters<BuildToolsModule["useAgentsPageBuildTools"]>[0];

const realBuildToolsSnapshot: BuildToolsSnapshotModule =
  await import("@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot");
const realGitActions: GitActionsModule = await import("../use-agent-studio-git-actions");
let useAgentsPageBuildTools: BuildToolsModule["useAgentsPageBuildTools"];
let testSpies: Array<{ mockRestore(): void }> = [];

const snapshotState = { current: createBuildToolsSnapshotFixture() };
const gitActionsState = { current: createGitActionsFixture(null) };
const snapshotMock = mock<BuildToolsSnapshotModule["useAgentStudioBuildToolsWorktreeSnapshot"]>(
  () => snapshotState.current,
);
const gitActionsMock = mock<GitActionsModule["useAgentStudioGitActions"]>(
  () => gitActionsState.current,
);
const resolveGitConflict = mock(async () => false as const);

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: { workspaceId: "workspace-repo", workspaceName: "Repo", repoPath: "/repo" },
  activeBranch: null,
  selectedView: {
    role: "build",
    taskId: "task-1",
    selectedTask: null,
    selectedSession: {
      identity: null,
      activityState: null,
      selectedModel: null,
      loadedSession: null,
      runtimeData: {
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
        catalogError: null,
        todosError: null,
        runtimePolicyError: null,
        contextError: null,
      },
      runtimeReadiness: {
        state: "ready",
        message: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      transcriptState: { kind: "visible" },
      sessionAuxiliaryError: null,
    },
  },
  isDiffsActive: true,
  isPanelOpen: true,
  repoSettings: null,
  repoSettingsError: null,
  loadRepoSettings: async () => {
    throw new Error("Unexpected repository settings read.");
  },
  onResolveGitConflict: resolveGitConflict,
  ...overrides,
});

beforeEach(async () => {
  snapshotState.current = createBuildToolsSnapshotFixture();
  gitActionsState.current = createGitActionsFixture(null);
  snapshotMock.mockClear();
  gitActionsMock.mockClear();
  testSpies = [
    spyOn(realBuildToolsSnapshot, "useAgentStudioBuildToolsWorktreeSnapshot").mockImplementation(
      snapshotMock,
    ),
    spyOn(realGitActions, "useAgentStudioGitActions").mockImplementation(gitActionsMock),
  ];
  ({ useAgentsPageBuildTools } = await import("./use-agents-page-build-tools"));
});

afterEach(() => {
  for (const testSpy of testSpies) testSpy.mockRestore();
  testSpies = [];
});

describe("useAgentsPageBuildTools", () => {
  test("loads git data only while the Diffs tab of an open panel is active", async () => {
    const harness = createHookHarness(useAgentsPageBuildTools, createArgs());
    await harness.mount();
    expect(snapshotMock.mock.calls.at(-1)?.[0]).toMatchObject({
      isGitTabActive: true,
      isRightPanelOpen: true,
    });

    await harness.update(createArgs({ isDiffsActive: false }));
    expect(snapshotMock.mock.calls.at(-1)?.[0]).toMatchObject({
      isGitTabActive: false,
      isRightPanelOpen: true,
    });

    await harness.update(createArgs({ isDiffsActive: false, isPanelOpen: false }));
    expect(snapshotMock.mock.calls.at(-1)?.[0]).toMatchObject({
      isGitTabActive: false,
      isRightPanelOpen: false,
    });
    await harness.unmount();
  });

  test("passes unmerged files and the conflict resolution to the git actions", async () => {
    snapshotState.current.diffData.fileStatuses = [
      { path: "src/conflict.ts", staged: false, status: "unmerged" },
      { path: "src/clean.ts", staged: false, status: "modified" },
    ];
    const harness = createHookHarness(useAgentsPageBuildTools, createArgs());
    await harness.mount();

    expect(gitActionsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      repoPath: "/repo",
      detectedConflictedFiles: ["src/conflict.ts"],
      onResolveGitConflict: resolveGitConflict,
    });
    await harness.unmount();
  });
});
