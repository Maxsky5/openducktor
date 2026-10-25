import { describe, expect, test } from "bun:test";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import { createTaskCardFixture } from "../agent-studio-test-utils";
import { buildAgentsPageDiffModel } from "./use-agents-page-right-panel-model";

type TestGitActions = {
  isGitActionsLocked: boolean;
  gitActionsLockReason: string | null;
  showLockReasonBanner: boolean;
};

const createEmptyScopeState = (): DiffDataState["scopeStatesByScope"]["target"] => ({
  branch: null,
  localChanges: null,
  gitConflict: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

const createDiffData = (): DiffDataState => ({
  branch: "main",
  worktreePath: "/repo",
  targetBranch: "origin/main",
  gitConflict: null,
  scopeStatesByScope: {
    target: createEmptyScopeState(),
    uncommitted: createEmptyScopeState(),
  },
  loadedScopesByScope: { target: false, uncommitted: false },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileStatuses: [],
  statusSnapshotKey: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 0,
  isLoading: false,
});

const createGitActions = (overrides: Partial<TestGitActions> = {}): TestGitActions => ({
  isGitActionsLocked: false,
  gitActionsLockReason: null,
  showLockReasonBanner: false,
  ...overrides,
});

describe("buildAgentsPageDiffModel", () => {
  const createPullRequestDetectionArgs = () => ({
    subjectKey: "task-24",
    buildToolsSnapshot: {
      diffData: createDiffData(),
      gitPanelContextMode: "repository" as const,
      openInTarget: { path: "/repo", disabledReason: null },
      resolvedGitPanelBranch: "main",
    },
    gitActions: createGitActions(),
    selectedTask: createTaskCardFixture({
      id: "task-24",
      status: "human_review",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: true },
        planner: { required: false, canSkip: true, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: false, canSkip: true, available: false, completed: true },
      },
    }),
    detectingPullRequestTaskIds: new Set<string>(),
    onDetectPullRequest: () => {},
  });

  test("hides unsupported Pull Request detection", () => {
    expect(
      buildAgentsPageDiffModel({
        ...createPullRequestDetectionArgs(),
        gitProviderContext: null,
      }).onDetectPullRequest,
    ).toBeUndefined();
  });

  test("shows detection progress for each task when several detections run", () => {
    const args = createPullRequestDetectionArgs();
    const busyTaskIds = new Set(["task-12", "task-24"]);
    for (const [taskId, isBusy] of [
      ["task-12", true],
      ["task-24", true],
      ["task-36", false],
    ] as const) {
      const model = buildAgentsPageDiffModel({
        ...args,
        selectedTask: { ...args.selectedTask, id: taskId },
        gitProviderContext: createGitProviderContextFixture(),
        detectingPullRequestTaskIds: busyTaskIds,
      });
      expect(Boolean(model.isDetectingPullRequest)).toBe(isBusy);
    }
  });

  test("carries the provider health error for supported Pull Request detection", () => {
    const common = {
      ...createPullRequestDetectionArgs(),
      gitProviderContext: createGitProviderContextFixture({ available: false }),
    };

    expect(buildAgentsPageDiffModel(common)).toMatchObject({
      onDetectPullRequest: expect.any(Function),
      detectPullRequestDisabledReason: "Sign in to GitHub CLI.",
    });
  });

  test("carries the provider read error for supported Pull Request detection", () => {
    const diffModel = buildAgentsPageDiffModel({
      ...createPullRequestDetectionArgs(),
      gitProviderContext: createGitProviderContextFixture(),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(diffModel).toMatchObject({
      onDetectPullRequest: expect.any(Function),
      detectPullRequestDisabledReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("keeps Pull Request detection visible when the initial provider read fails", () => {
    const diffModel = buildAgentsPageDiffModel({
      ...createPullRequestDetectionArgs(),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(diffModel).toMatchObject({
      onDetectPullRequest: expect.any(Function),
      detectPullRequestDisabledReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("hides unsupported Pull Request detection when the provider refresh fails", () => {
    const diffModel = buildAgentsPageDiffModel({
      ...createPullRequestDetectionArgs(),
      gitProviderContext: createGitProviderContextFixture({ supportsPullRequests: false }),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(diffModel.onDetectPullRequest).toBeUndefined();
  });

  test("keeps unrelated Git actions available for invalid comparison metadata", () => {
    const validationError = "Invalid openducktor.targetBranch metadata: missing field `branch`.";
    const diffModel = buildAgentsPageDiffModel({
      subjectKey: "task-24",
      buildToolsSnapshot: {
        diffData: createDiffData(),
        gitPanelContextMode: "repository",
        openInTarget: { path: "/repo", disabledReason: null },
        resolvedGitPanelBranch: "main",
      },
      gitActions: createGitActions(),
      selectedTask: createTaskCardFixture({
        id: "task-24",
        targetBranchError: validationError,
      }),
      detectingPullRequestTaskIds: new Set<string>(),
      onDetectPullRequest: () => {},
    });

    expect(diffModel.targetBranch).toBe("origin/main");
    expect(diffModel.isGitActionsLocked).toBe(false);
    expect(diffModel.gitActionsLockReason).toBeNull();
    expect(diffModel.showLockReasonBanner).toBe(false);
  });
});
