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
  buildAgentStudioRightPanelModel,
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
    target: emptyDiffScopeState,
    uncommitted: emptyDiffScopeState,
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
  refresh: () => {},
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
  repoPath: "/repo",
  taskId: "task-12",
  worktreePath: "/tmp/worktree/task-12",
  scripts: [],
  selectedScriptId: null,
  selectedScript: null,
  selectedScriptLogBuffer: null,
  error: null,
  isStartPending: false,
  isStopPending: false,
  isRestartPending: false,
  onSelectScript: () => {},
  onStart: () => {},
  onStop: () => {},
  onRestart: () => {},
};

describe("useAgentStudioRightPanel", () => {
  test("builds builder tools panel model when panel kind is build_tools", () => {
    const model = buildAgentStudioRightPanelModel({
      panelKind: "build_tools",
      documentsModel,
      diffModel,
      devServerModel,
    });

    expect(model).not.toBeNull();
    expect(model?.kind).toBe("build_tools");
    if (model?.kind === "build_tools") {
      expect(model.diffModel.diffScope).toBe("target");
      expect(model.diffModel.commitAll).toBe(diffModel.commitAll);
      expect(model.diffModel.rebaseOntoTarget).toBe(diffModel.rebaseOntoTarget);
      expect(model.diffModel.pushBranch).toBe(diffModel.pushBranch);
      expect(model.devServerModel.mode).toBe("stopped");
    }
  });

  test("builds documents panel model for non-build panel kind", () => {
    const model = buildAgentStudioRightPanelModel({
      panelKind: "documents",
      documentsModel,
      diffModel,
      devServerModel,
    });

    expect(model).toEqual({
      kind: "documents",
      documentsModel,
    });
  });

  test("returns documents panel open by default for spec role when available", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasDocumentPanel: true,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBe("documents");
    expect(harness.getLatest().isPanelOpen).toBe(true);
    expect(harness.getLatest().rightPanelToggleModel?.kind).toBe("documents");

    await harness.unmount();
  });

  test("hides panel and toggle when no task context is active", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasTaskContext: false,
      hasDocumentPanel: true,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBeNull();
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("persists open state per role when switching roles", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasDocumentPanel: true,
    });

    await harness.mount();
    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });

    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update({
      role: "planner",
      hasDocumentPanel: true,
    });
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "spec",
      hasDocumentPanel: true,
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("hides panel and toggle when role panel kind is unavailable", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasBuildToolsPanel: false,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBeNull();
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("uses build tools panel state for build role when available", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasBuildToolsPanel: true,
    });

    await harness.mount();
    expect(harness.getLatest().panelKind).toBe("build_tools");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update({
      role: "spec",
      hasDocumentPanel: true,
      hasBuildToolsPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("documents");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "build",
      hasDocumentPanel: false,
      hasBuildToolsPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("build_tools");
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("persists build panel state globally and restores across sessions", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasBuildToolsPanel: true,
    });

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

    const secondHarness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasBuildToolsPanel: true,
    });

    await secondHarness.mount();
    expect(secondHarness.getLatest().isPanelOpen).toBe(false);
    await secondHarness.unmount();
  });

  test("logs malformed persisted panel state before recovering defaults", async () => {
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    try {
      globalThis.localStorage.setItem(toRightPanelStorageKey(), "{bad-json");

      const harness = createHookHarness({
        role: "spec",
        hasDocumentPanel: true,
      });

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
