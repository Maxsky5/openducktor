import { afterEach, beforeEach, spyOn } from "bun:test";
import { type RenderResult, render as testingLibraryRender } from "@testing-library/react";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import type { DiffScopeState } from "@/features/agent-studio-git/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { AgentStudioGitPanel, type AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import {
  FILE_LIST_VIEW_MODE_STORAGE_KEY,
  useFileListViewModeStore,
} from "./agent-studio-git-panel/file-list-view-preference";

const actualThemeProvider = await import("@/components/layout/theme-provider");
const actualBranchSelector = await import("@/components/features/repository/branch-selector");
const actualPierreDiffsReact = await import("@pierre/diffs/react");

export const toScopeState = (overrides: Partial<DiffScopeState> = {}): DiffScopeState => ({
  branch: "feature/task-11",
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

export const toFileDiff = (file: string) => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff: "@@ -1 +1 @@\n-old\n+new\n",
});

export const baseModel = (
  overrides: Partial<AgentStudioGitPanelModel> = {},
): AgentStudioGitPanelModel => {
  const model: AgentStudioGitPanelModel = {
    subjectKey: "task-11",
    contextMode: "worktree",
    branch: "feature/task-11",
    worktreePath: "/tmp/worktree",
    targetBranch: "origin/main",
    diffScope: "target",
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
    fileDiffs: [],
    fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
    hashVersion: 1,
    statusHash: "0123456789abcdef",
    diffHash: "fedcba9876543210",
    uncommittedFileCount: 1,
    isLoading: false,
    error: null,
    refresh: async () => {},
    setDiffScope: () => {},
    isCommitting: false,
    isPushing: false,
    isRebasing: false,
    commitError: null,
    pushError: null,
    rebaseError: null,
    commitAll: async () => true,
    pushBranch: async () => {},
    rebaseOntoTarget: async () => {},
    pullFromUpstream: async () => {},
    ...overrides,
  };

  if (overrides.scopeStatesByScope === undefined) {
    const derivedScopeState = toScopeState({
      branch: model.branch,
      fileDiffs: model.fileDiffs,
      fileStatuses: model.fileStatuses,
      uncommittedFileCount: model.uncommittedFileCount,
      commitsAheadBehind: model.commitsAheadBehind,
      upstreamAheadBehind: model.upstreamAheadBehind,
      upstreamStatus: model.upstreamStatus,
      error: model.error,
      hashVersion: model.hashVersion,
      statusHash: model.statusHash,
      diffHash: model.diffHash,
    });
    model.scopeStatesByScope = {
      target: derivedScopeState,
      uncommitted: derivedScopeState,
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

  return model;
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

/** Mocks the theme, the branch selector, and the Pierre viewers, and resets the remembered file list view. */
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
    });
    globalThis.localStorage.removeItem(FILE_LIST_VIEW_MODE_STORAGE_KEY);
  });
}
