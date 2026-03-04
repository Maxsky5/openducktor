import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
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

const diffModel: AgentStudioGitPanelModel = {
  branch: "feature/task-12",
  worktreePath: "/tmp/worktree/task-12",
  targetBranch: "origin/main",
  diffScope: "target",
  commitsAheadBehind: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  isLoading: false,
  error: null,
  refresh: () => {},
  selectedFile: null,
  setSelectedFile: () => {},
  setDiffScope: () => {},
  isCommitting: false,
  isPushing: false,
  isRebasing: false,
  commitError: null,
  pushError: null,
  rebaseError: null,
  commitAll: async () => {},
  pushBranch: async () => {},
  rebaseOntoTarget: async () => {},
};

describe("useAgentStudioRightPanel", () => {
  test("builds enhanced diff panel model when panel kind is diff", () => {
    const model = buildAgentStudioRightPanelModel({
      panelKind: "diff",
      documentsModel,
      diffModel,
    });

    expect(model).not.toBeNull();
    expect(model?.kind).toBe("diff");
    if (model?.kind === "diff") {
      expect(model.diffModel.diffScope).toBe("target");
      expect(model.diffModel.commitAll).toBe(diffModel.commitAll);
      expect(model.diffModel.rebaseOntoTarget).toBe(diffModel.rebaseOntoTarget);
      expect(model.diffModel.pushBranch).toBe(diffModel.pushBranch);
    }
  });

  test("builds documents panel model for non-build panel kind", () => {
    const model = buildAgentStudioRightPanelModel({
      panelKind: "documents",
      documentsModel,
      diffModel,
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
      hasDiffPanel: false,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBeNull();
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("uses diff panel state for build role when available", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: true,
    });

    await harness.mount();
    expect(harness.getLatest().panelKind).toBe("diff");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update({
      role: "spec",
      hasDocumentPanel: true,
      hasDiffPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("documents");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("diff");
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("persists build panel state globally and restores across sessions", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: true,
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
      hasDiffPanel: true,
    });

    await secondHarness.mount();
    expect(secondHarness.getLatest().isPanelOpen).toBe(false);
    await secondHarness.unmount();
  });
});
