import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentStudioDevServerPanelModel } from "@/components/features/agents/agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
import type { DiffScopeState } from "@/features/agent-studio-git/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toRightPanelStorageKey } from "./agents-page-selection";
import {
  buildTaskExecutionPanelModel,
  useAgentStudioRightPanel,
} from "./use-agent-studio-right-panel";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRightPanel>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRightPanel, initialProps);

const createMemoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) ?? null) : null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
};

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: createMemoryStorage(),
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
  });
});

const documentsModel = {
  activeDocument: null,
};

const emptyDiffScopeState: DiffScopeState = {
  branch: "feature/task-12",
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
};

const diffModel: AgentStudioGitPanelModel = {
  contextMode: "worktree",
  branch: "feature/task-12",
  worktreePath: "/tmp/worktree/task-12",
  targetBranch: "origin/main",
  diffScope: "target",
  scopeStatesByScope: {
    target: { ...emptyDiffScopeState },
    uncommitted: { ...emptyDiffScopeState },
  },
  loadedScopesByScope: {
    target: true,
    uncommitted: true,
  },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileDiffs: [],
  fileStatuses: [],
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
  uncommittedFileCount: 0,
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
};

const devServerModel: AgentStudioDevServerPanelModel = {
  mode: "stopped",
  isExpanded: false,
  isLoading: false,
  disabledReason: null,
  repoPath: "/repo",
  taskId: "task-12",
  worktreePath: "/tmp/worktree/task-12",
  scripts: [],
  selectedScriptId: null,
  selectedScript: null,
  selectedScriptTerminalBuffer: null,
  error: null,
  isStartPending: false,
  isStopPending: false,
  isRestartPending: false,
  onSelectScript: () => {},
  onStart: () => {},
  onStop: () => {},
  onRestart: () => {},
};

const fileExplorerModel = {
  rootPath: "/repo",
  targetBranch: "origin/main",
  unavailableReason: null,
  isActive: false,
  selectedFile: null,
  onSelectFile: () => {},
};

const tabs = [
  { id: "document" as const, label: "Document" },
  { id: "git" as const, label: "Git" },
  { id: "file_explorer" as const, label: "File explorer" },
];

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  role: "spec",
  hasDocumentPanel: true,
  hasGithubIntegration: false,
  hasLinkedGithubPullRequest: false,
  ...overrides,
});

describe("useAgentStudioRightPanel", () => {
  test("builds task execution panel model with git and dev server models", () => {
    const model = buildTaskExecutionPanelModel({
      tabs,
      activeTabId: "git",
      documentModel: documentsModel,
      diffModel,
      fileExplorerModel,
      ciChecksModel: null,
      devServerModel,
      onActiveTabChange: () => {},
    });

    expect(model).not.toBeNull();
    expect(model?.activeTabId).toBe("git");
    expect(model?.gitModel.diffScope).toBe("target");
    expect(model?.gitModel.commitAll).toBe(diffModel.commitAll);
    expect(model?.gitModel.rebaseOntoTarget).toBe(diffModel.rebaseOntoTarget);
    expect(model?.gitModel.pushBranch).toBe(diffModel.pushBranch);
    expect(model?.devServerModel?.mode).toBe("stopped");
  });

  test("builds document tab model when document tab is available", () => {
    const model = buildTaskExecutionPanelModel({
      tabs,
      activeTabId: "document",
      documentModel: documentsModel,
      diffModel,
      fileExplorerModel,
      ciChecksModel: null,
      devServerModel: null,
      onActiveTabChange: () => {},
    });

    expect(model?.documentModel).toBe(documentsModel);
    expect(model?.tabs.map((tab) => tab.id)).toEqual(["document", "git", "file_explorer"]);
  });

  test("returns task execution panel open by default for spec role when available", async () => {
    const harness = createHookHarness(createHookArgs());

    await harness.mount();

    expect(harness.getLatest().activeTabId).toBe("document");
    expect(harness.getLatest().tabs.map((tab) => tab.id)).toEqual([
      "document",
      "git",
      "file_explorer",
    ]);
    expect(harness.getLatest().isPanelOpen).toBe(true);
    expect(harness.getLatest().rightPanelToggleModel?.kind).toBe("task_execution");

    await harness.unmount();
  });

  test("hides panel and toggle when no task context is active", async () => {
    const harness = createHookHarness(
      createHookArgs({
        hasTaskContext: false,
      }),
    );

    await harness.mount();

    expect(harness.getLatest().activeTabId).toBeNull();
    expect(harness.getLatest().tabs).toEqual([]);
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("persists open state per role when switching roles", async () => {
    const harness = createHookHarness(createHookArgs());

    await harness.mount();
    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });

    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update(
      createHookArgs({
        role: "planner",
      }),
    );
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update(
      createHookArgs({
        role: "spec",
      }),
    );
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("omits document tab when document role has no active document", async () => {
    const harness = createHookHarness(
      createHookArgs({
        role: "spec",
        hasDocumentPanel: false,
      }),
    );

    await harness.mount();

    expect(harness.getLatest().activeTabId).toBe("git");
    expect(harness.getLatest().tabs.map((tab) => tab.id)).toEqual(["git", "file_explorer"]);
    expect(harness.getLatest().isPanelOpen).toBe(true);
    expect(harness.getLatest().rightPanelToggleModel?.kind).toBe("task_execution");

    await harness.unmount();
  });

  test("shows CI checks only for tasks with a linked GitHub pull request", async () => {
    const harness = createHookHarness(
      createHookArgs({
        hasGithubIntegration: true,
        hasLinkedGithubPullRequest: true,
      }),
    );

    await harness.mount();

    expect(harness.getLatest().tabs.map((tab) => tab.id)).toEqual([
      "document",
      "git",
      "file_explorer",
      "ci_checks",
    ]);

    await harness.update(
      createHookArgs({
        hasGithubIntegration: true,
        hasLinkedGithubPullRequest: false,
      }),
    );
    expect(harness.getLatest().tabs.map((tab) => tab.id)).toEqual([
      "document",
      "git",
      "file_explorer",
    ]);

    await harness.unmount();
  });

  test("uses git tab state for build role when available", async () => {
    const harness = createHookHarness(
      createHookArgs({
        role: "build",
        hasDocumentPanel: false,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().activeTabId).toBe("git");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update(
      createHookArgs({
        role: "spec",
        hasDocumentPanel: true,
      }),
    );
    expect(harness.getLatest().activeTabId).toBe("document");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update(
      createHookArgs({
        role: "build",
        hasDocumentPanel: false,
      }),
    );
    expect(harness.getLatest().activeTabId).toBe("git");
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("persists build panel state globally and restores across sessions", async () => {
    const harness = createHookHarness(
      createHookArgs({
        role: "build",
        hasDocumentPanel: false,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();

    const persistedRaw = globalThis.localStorage.getItem(toRightPanelStorageKey());
    expect(persistedRaw).not.toBeNull();
    const persisted = JSON.parse(persistedRaw ?? "{}");
    expect(persisted.build).toBe(false);

    const secondHarness = createHookHarness(
      createHookArgs({
        role: "build",
        hasDocumentPanel: false,
      }),
    );

    await secondHarness.mount();
    expect(secondHarness.getLatest().isPanelOpen).toBe(false);
    await secondHarness.unmount();
  });

  test("preserves the stored preferred open-in tool when panel state changes", async () => {
    globalThis.localStorage.setItem(
      toRightPanelStorageKey(),
      JSON.stringify({ openInToolId: "zed", build: true }),
    );

    const harness = createHookHarness(
      createHookArgs({
        role: "build",
        hasDocumentPanel: false,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });

    const persisted = JSON.parse(globalThis.localStorage.getItem(toRightPanelStorageKey()) ?? "{}");
    expect(persisted.openInToolId).toBe("zed");
    expect(persisted.build).toBe(false);

    await harness.unmount();
  });

  test("logs malformed persisted panel state before recovering defaults", async () => {
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    try {
      globalThis.localStorage.setItem(toRightPanelStorageKey(), "{bad-json");

      const harness = createHookHarness(createHookArgs());

      await harness.mount();

      expect(harness.getLatest().isPanelOpen).toBe(true);
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(
        errorCalls.some((call) =>
          String(call[0] ?? "").includes("Failed to parse persisted panel state"),
        ),
      ).toBe(true);

      await harness.unmount();
    } finally {
      console.error = originalError;
    }
  });
});
