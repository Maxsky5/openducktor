import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DevServerScriptState } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import type { DiffScopeState } from "@/features/agent-studio-git/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { AgentStudioDevServerPanelModel } from "./agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import type {
  TaskExecutionPanelModel,
  TaskExecutionPanelToggleModel,
} from "./task-execution-panel";

type TaskExecutionPanelComponent = typeof import("./task-execution-panel")["TaskExecutionPanel"];
type TaskExecutionPanelToggleButtonComponent =
  typeof import("./task-execution-panel")["TaskExecutionPanelToggleButton"];

let TaskExecutionPanel: TaskExecutionPanelComponent;
let TaskExecutionPanelToggleButton: TaskExecutionPanelToggleButtonComponent;

const actualPierreTrees = await import("@pierre/trees");
const actualPierreTreesReact = await import("@pierre/trees/react");
const actualDevServerSettingsAction = await import("./agent-studio-dev-server-settings-action");

beforeEach(async () => {
  mock.module("@pierre/trees", () => ({
    preparePresortedFileTreeInput: (paths: string[]) => ({ paths }),
    themeToTreeStyles: () => ({}),
  }));

  mock.module("@pierre/trees/react", () => ({
    FileTree: () => createElement("div", { "data-testid": "mock-pierre-file-tree" }),
    useFileTree: () => ({
      model: {
        resetPaths: () => {},
        setGitStatus: () => {},
        setIcons: () => {},
        setSearch: () => {},
      },
    }),
    useFileTreeSearch: () => ({
      value: "",
      isOpen: false,
      open: () => {},
      setValue: () => {},
    }),
  }));

  mock.module("./agent-studio-dev-server-settings-action", () => ({
    AgentStudioDevServerSettingsAction: () =>
      createElement("button", { type: "button" }, "Configure dev server commands"),
  }));

  ({ TaskExecutionPanel, TaskExecutionPanelToggleButton } = await import("./task-execution-panel"));
});

afterEach(async () => {
  await restoreMockedModules([
    ["@pierre/trees", async () => actualPierreTrees],
    ["@pierre/trees/react", async () => actualPierreTreesReact],
    [
      "./agent-studio-dev-server-settings-action",
      async () => actualDevServerSettingsAction,
    ],
  ]);
});

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
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

const selectedScript: DevServerScriptState = {
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "running",
  runIdentity: {
    runId: "frontend:1",
    runOrder: { hostInstanceId: "host-1", generation: 1 },
  },
  pid: 123,
  startedAt: "2026-03-19T10:00:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [
    {
      scriptId: "frontend",
      runIdentity: {
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
      },
      sequence: 0,
      data: "ready in 120ms\r\n",
      timestamp: "2026-03-19T10:00:01.000Z",
    },
  ],
};

const devServerModel: AgentStudioDevServerPanelModel = {
  mode: "active",
  isExpanded: true,
  isLoading: false,
  disabledReason: null,
  repoPath: "/repo",
  taskId: "task-12",
  worktreePath: "/tmp/worktree/task-12",
  scripts: [selectedScript],
  selectedScriptId: selectedScript.scriptId,
  selectedScript,
  selectedScriptTerminalBuffer: {
    entries: selectedScript.bufferedTerminalChunks.map((terminalChunk) => ({
      ...terminalChunk,
    })),
    lastSequence: selectedScript.bufferedTerminalChunks.at(-1)?.sequence ?? null,
    resetToken: 0,
  } satisfies AgentStudioDevServerTerminalBuffer,
  error: null,
  isStartPending: false,
  isStopPending: false,
  isRestartPending: false,
  onSelectScript: () => {},
  onStart: () => {},
  onStop: () => {},
  onRestart: () => {},
};

const basePanelModel = {
  tabs: [
    { id: "document", label: "Document" },
    { id: "git", label: "Git" },
    { id: "file_explorer", label: "File explorer" },
    { id: "ci_checks", label: "CI Checks" },
  ],
  activeTabId: "document",
  onActiveTabChange: () => {},
  documentModel: {
    activeDocument: {
      title: "Specification",
      description: "Current specification document for this task.",
      emptyState: "No spec document yet.",
      document: {
        ...emptyDoc,
        markdown: "# Spec",
      },
    },
  },
  gitModel: diffModel,
  fileExplorerModel: {
    rootPath: null,
    unavailableReason: "No repository is selected.",
    isActive: false,
    selectedFile: null,
    onSelectFile: () => {},
  },
  ciChecksModel: {
    isActive: false,
    queryInput: null,
  },
  devServerModel: null,
} satisfies TaskExecutionPanelModel;

const renderPanel = (model: TaskExecutionPanelModel): string =>
  renderToStaticMarkup(
    createElement(
      QueryProvider,
      { useIsolatedClient: true },
      createElement(TaskExecutionPanel, { model }),
    ),
  );

describe("TaskExecutionPanelToggleButton", () => {
  test("renders hide label when task execution panel is open", () => {
    const model: TaskExecutionPanelToggleModel = {
      kind: "task_execution",
      isOpen: true,
      onToggle: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(TaskExecutionPanelToggleButton, {
        model,
      }),
    );

    expect(html).toContain("Hide task execution panel");
  });

  test("renders show label when task execution panel is closed", () => {
    const model: TaskExecutionPanelToggleModel = {
      kind: "task_execution",
      isOpen: false,
      onToggle: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(TaskExecutionPanelToggleButton, {
        model,
      }),
    );

    expect(html).toContain("Show task execution panel");
  });
});

describe("TaskExecutionPanel", () => {
  test("renders configured tabs and document content", () => {
    const html = renderPanel(basePanelModel);

    expect(html).toContain("task-execution-tab-document");
    expect(html).toContain("task-execution-tab-git");
    expect(html).toContain("task-execution-tab-file_explorer");
    expect(html).toContain("task-execution-tab-ci_checks");
    expect(html.match(/task-execution-tab-separator/g)?.length).toBe(3);
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("bg-transparent");
    expect(html).toContain("bg-selected-surface");
    expect(html).toContain("text-selected-accent");
    expect(html).toContain("Document");
    expect(html).toContain("Git");
    expect(html).toContain("File explorer");
    expect(html).toContain("CI Checks");
    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
  });

  test("renders Open In in the shared panel header", () => {
    const html = renderPanel({
      ...basePanelModel,
      gitModel: {
        ...diffModel,
        openInTargetPath: "/tmp/worktree/task-12",
        openInDisabledReason: null,
        openDirectoryInTool: async () => {},
      },
    });

    expect(html).toContain("agent-studio-git-open-in-actions");
    expect(html).toContain("agent-studio-git-open-in-default-button");
  });

  test("renders Git content as a tab without Dev Server content", () => {
    const html = renderPanel({
      ...basePanelModel,
      tabs: [
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "git",
      documentModel: null,
      ciChecksModel: null,
    });

    expect(html).toContain("Current");
    expect(html).toContain("Target");
    expect(html).toContain("origin/main");
    expect(html).not.toContain("agent-studio-dev-server-terminal");
  });

  test("renders Dev Servers below the task execution panel", () => {
    const html = renderPanel({
      ...basePanelModel,
      tabs: [
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "git",
      documentModel: null,
      ciChecksModel: null,
      devServerModel,
    });

    expect(html).toContain("Git");
    expect(html).toContain("origin/main");
    expect(html).toContain("Stop");
    expect(html).toContain("agent-studio-dev-server-terminal");
    expect(html).not.toContain("Dev Servers</button>");
  });

  test("renders the dev server settings action in compact mode", () => {
    const html = renderPanel({
      ...basePanelModel,
      devServerModel: { ...devServerModel, isExpanded: false },
    });

    expect(html).toContain("Configure dev server commands");
  });
});
