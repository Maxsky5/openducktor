import { afterEach, beforeEach, spyOn } from "bun:test";
import type { GitFileDiff, FileStatus, GitLocalChanges } from "@openducktor/contracts";
import { type RenderResult, render as testingLibraryRender } from "@testing-library/react";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import type { DiffScope, DiffScopeState } from "@/features/agent-studio-git/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { AgentStudioGitPanel, type AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import { gitPanelContextKey } from "./agent-studio-git-panel/agent-studio-git-panel";
import {
  FILE_LIST_VIEW_MODE_STORAGE_KEY,
  useFileListViewModeStore,
} from "./agent-studio-git-panel/file-list-view-preference";
import { useGitPanelViewStore } from "./agent-studio-git-panel/git-panel-view-store";

const actualThemeProvider = await import("@/components/layout/theme-provider");
const actualBranchSelector = await import("@/components/features/repository/branch-selector");
const actualPierreDiffsReact = await import("@pierre/diffs/react");

export const toScopeState = (overrides: Partial<DiffScopeState> = {}): DiffScopeState => ({
  branch: "feature/task-11",
  localChanges: null,
  fileDiffs: [],
  fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
  uncommittedFileCount: 1,
  commitsAheadBehind: { ahead: 2, behind: 1 },
  upstreamAheadBehind: { ahead: 1, behind: 0 },
  upstreamStatus: "tracking",
  error: null,
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
  ...overrides,
});

export const toFileDiff = (file: string): GitFileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff: "@@ -1 +1 @@\n-old\n+new\n",
});

const TEST_SNAPSHOT = {
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
};

const toLocalGroup = (paths: string[], staged: boolean) => ({
  fileStatuses: paths.map((path): FileStatus => ({ path, status: "modified", staged })),
  fileDiffs: paths.map(toFileDiff),
  snapshot: { ...TEST_SNAPSHOT },
});

/** Local changes in the host shape. Conflicts stay out of the staged and unstaged groups. */
export const toLocalChanges = ({
  unstaged = [],
  staged = [],
  conflicted = [],
  branch = "feature/task-11",
}: {
  unstaged?: string[];
  staged?: string[];
  conflicted?: string[];
  /** Null reads as a detached checkout. */
  branch?: string | null;
} = {}): GitLocalChanges => {
  const unstagedGroup = toLocalGroup(unstaged, false);
  const stagedGroup = toLocalGroup(staged, true);
  const conflictedStatuses = conflicted.map((path): FileStatus => ({
    path,
    status: "unmerged",
    staged: false,
  }));
  const fileStatuses = new Map<string, FileStatus>();
  for (const status of [
    ...stagedGroup.fileStatuses,
    ...unstagedGroup.fileStatuses,
    ...conflictedStatuses,
  ]) {
    fileStatuses.set(status.path, status);
  }
  return {
    currentBranch: branch === null ? { detached: true } : { name: branch, detached: false },
    fileStatuses: [...fileStatuses.values()],
    unstaged: unstagedGroup,
    staged: stagedGroup,
    conflicted: { fileStatuses: conflictedStatuses, fileDiffs: conflicted.map(toFileDiff) },
    upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/tmp/worktree",
      targetBranch: "origin/main",
      diffScope: "uncommitted",
      observedAtMs: 1,
      ...TEST_SNAPSHOT,
    },
  };
};

/** Splits flat test statuses into local groups, like the host does for one worktree. */
const groupLocalChanges = (
  fileStatuses: FileStatus[],
  fileDiffs: GitFileDiff[],
  branch: string | null,
): GitLocalChanges => {
  const changes = toLocalChanges({ branch });
  const groupOf = (path: string) => {
    const status = fileStatuses.find((entry) => entry.path === path);
    if (status?.status === "unmerged") return changes.conflicted;
    return status?.staged ? changes.staged : changes.unstaged;
  };
  for (const status of fileStatuses) {
    groupOf(status.path).fileStatuses.push({ ...status });
  }
  for (const diff of fileDiffs) {
    groupOf(diff.file).fileDiffs.push({ ...diff });
  }
  changes.fileStatuses = fileStatuses.map((status) => ({ ...status }));
  return changes;
};

/**
 * Test input for a panel model. `fileDiffs` and `error` fill both scopes. `diffScope` is the tab
 * that a new panel view shows first.
 */
export type PanelModelInput = Partial<AgentStudioGitPanelModel> & {
  fileDiffs?: GitFileDiff[];
  error?: string | null;
  diffScope?: DiffScope;
};

export const baseModel = ({
  fileDiffs = [],
  error = null,
  diffScope = "target",
  ...overrides
}: PanelModelInput = {}): AgentStudioGitPanelModel => {
  const model: AgentStudioGitPanelModel = {
    subjectKey: "task-11",
    contextMode: "worktree",
    branch: "feature/task-11",
    worktreePath: "/tmp/worktree",
    targetBranch: "origin/main",
    scopeStatesByScope: {
      target: toScopeState(),
      uncommitted: toScopeState(),
    },
    loadedScopesByScope: {
      target: true,
      uncommitted: true,
    },
    commitsAheadBehind: { ahead: 2, behind: 1 },
    upstreamAheadBehind: { ahead: 1, behind: 0 },
    upstreamStatus: "tracking",
    fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
    hashVersion: 1,
    statusHash: "0123456789abcdef",
    diffHash: "fedcba9876543210",
    uncommittedFileCount: 1,
    isLoading: false,
    refresh: async () => {},
    isCommitting: false,
    isPushing: false,
    isRebasing: false,
    commitError: null,
    pushError: null,
    rebaseError: null,
    commit: async () => true,
    changeSelection: () => {},
    pushBranch: async () => {},
    rebaseOntoTarget: async () => {},
    pullFromUpstream: async () => {},
    ...overrides,
  };

  if (overrides.scopeStatesByScope === undefined) {
    const derivedScopeState = toScopeState({
      branch: model.branch,
      fileDiffs,
      fileStatuses: model.fileStatuses,
      uncommittedFileCount: model.uncommittedFileCount,
      commitsAheadBehind: model.commitsAheadBehind,
      upstreamAheadBehind: model.upstreamAheadBehind,
      upstreamStatus: model.upstreamStatus,
      error,
      hashVersion: model.hashVersion,
      statusHash: model.statusHash,
      diffHash: model.diffHash,
    });
    model.scopeStatesByScope = {
      target: derivedScopeState,
      uncommitted: {
        ...derivedScopeState,
        localChanges: groupLocalChanges(model.fileStatuses, fileDiffs, model.branch),
      },
    };
  }

  if (overrides.loadedScopesByScope === undefined) {
    model.loadedScopesByScope = {
      target: true,
      uncommitted: true,
    };
  }

  if (overrides.uncommittedFileCount === undefined) {
    model.uncommittedFileCount = model.fileStatuses.length;
    if (overrides.scopeStatesByScope === undefined) {
      model.scopeStatesByScope = {
        target: {
          ...model.scopeStatesByScope.target,
          uncommittedFileCount: model.uncommittedFileCount,
        },
        uncommitted: {
          ...model.scopeStatesByScope.uncommitted,
          uncommittedFileCount: model.uncommittedFileCount,
        },
      };
    }
  }

  showFirstTab(model, diffScope);
  return model;
};

/** A user choice stays. Only a panel view without one takes the test's first tab. */
const showFirstTab = (model: AgentStudioGitPanelModel, tab: DiffScope): void => {
  const contextKey = gitPanelContextKey(model);
  const { views, update } = useGitPanelViewStore.getState();
  if (!views[contextKey]) update(contextKey, () => ({ selectedTab: tab }));
};

export const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

export const render = (element: ReactElement): RenderResult =>
  testingLibraryRender(createElement(QueryProvider, { useIsolatedClient: true }, element));

export const renderAgentStudioGitPanelElement = (model: AgentStudioGitPanelModel): ReactElement =>
  createElement(
    QueryProvider,
    { useIsolatedClient: true },
    createElement(AgentStudioGitPanel, { model }),
  );

export const ensureRenderer = (renderer: RenderResult | null): RenderResult => {
  if (!renderer) {
    throw new Error("AgentStudioGitPanel renderer is not initialized");
  }
  return renderer;
};

/** Mocks the theme, the branch selector, and the Pierre viewers, and resets the remembered file list view and Git panel views. */
export function setupAgentStudioGitPanelTests(): void {
  let moduleSpies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    moduleSpies = [
      spyOn(actualThemeProvider, "useTheme").mockImplementation(() => ({
        theme: "light",
        themePreference: "light",
        setThemePreference: () => {},
      })),
      spyOn(actualBranchSelector, "BranchSelector").mockImplementation(
        ({
          value,
          options,
          onValueChange,
          disabled,
          className,
          popoverClassName,
          open,
          onOpenChange,
        }: {
          value: string;
          options: { value: string; label: string }[];
          onValueChange: (value: string) => void;
          disabled?: boolean;
          className?: string;
          popoverClassName?: string;
          open?: boolean;
          onOpenChange?: (open: boolean) => void;
        }) =>
          createElement(
            "button",
            {
              type: "button",
              disabled,
              className,
              "data-testid": "mock-branch-selector",
              "data-popover-class": popoverClassName,
              onClick: () => {
                if (open === false) {
                  onOpenChange?.(true);
                  return;
                }
                const fallback = options.find((option) => option.value !== value)?.value ?? value;
                onValueChange(fallback);
              },
            },
            value,
          ),
      ),
      spyOn(actualPierreDiffsReact, "File").mockImplementation(() =>
        createElement("div", { "data-testid": "mock-pierre-file-viewer" }),
      ),
      spyOn(actualPierreDiffsReact, "FileDiff").mockImplementation(() =>
        createElement("div", { "data-testid": "mock-pierre-diff-viewer" }),
      ),
      spyOn(actualPierreDiffsReact, "Virtualizer").mockImplementation(
        ({ children }: { children: ReactNode }) =>
          createElement("div", { "data-testid": "mock-pierre-virtualizer" }, children),
      ),
      spyOn(actualPierreDiffsReact, "useWorkerPool").mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    for (const moduleSpy of moduleSpies) {
      moduleSpy.mockRestore();
    }
    moduleSpies = [];
    // Panels can still be mounted here, so the store reset must run inside act.
    act(() => {
      useFileListViewModeStore.setState({ viewMode: "tree" });
      useGitPanelViewStore.setState({ views: {} });
    });
    globalThis.localStorage.removeItem(FILE_LIST_VIEW_MODE_STORAGE_KEY);
  });
}
