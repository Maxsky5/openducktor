import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DevServerScriptState } from "@openducktor/contracts";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import type { DiffScopeState } from "@/features/agent-studio-git/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { AgentStudioDevServerPanelModel } from "./agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel";

type AgentStudioRightPanelComponent =
  typeof import("./agent-studio-right-panel")["AgentStudioRightPanel"];
type AgentStudioRightPanelToggleButtonComponent =
  typeof import("./agent-studio-right-panel")["AgentStudioRightPanelToggleButton"];

let AgentStudioRightPanel: AgentStudioRightPanelComponent;
let AgentStudioRightPanelToggleButton: AgentStudioRightPanelToggleButtonComponent;

beforeEach(async () => {
  mock.module("@/contexts/DiffWorkerProvider", () => ({
    DiffWorkerProvider: ({ children }: { children: ReactNode }) => children,
  }));

  mock.module("@pierre/diffs/react", () => ({
    FileDiff: () => createElement("div", { "data-testid": "mock-pierre-diff-viewer" }),
    Virtualizer: ({ children }: { children: ReactNode }) =>
      createElement("div", { "data-testid": "mock-pierre-virtualizer" }, children),
    useWorkerPool: () => null,
  }));

  ({ AgentStudioRightPanel, AgentStudioRightPanelToggleButton } = await import(
    "./agent-studio-right-panel"
  ));
});

afterEach(async () => {
  await restoreMockedModules([
    ["@/contexts/DiffWorkerProvider", () => import("@/contexts/DiffWorkerProvider")],
    ["@pierre/diffs/react", () => import("@pierre/diffs/react")],
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
  pid: 123,
  startedAt: "2026-03-19T10:00:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [
    {
      scriptId: "frontend",
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

describe("AgentStudioRightPanelToggleButton", () => {
  test("renders hide label when documents panel is open", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanelToggleButton, {
        model: {
          kind: "documents",
          isOpen: true,
          onToggle: () => {},
        },
      }),
    );

    expect(html).toContain("Hide documents panel");
  });

  test("renders show label when builder tools panel is closed", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanelToggleButton, {
        model: {
          kind: "build_tools",
          isOpen: false,
          onToggle: () => {},
        },
      }),
    );

    expect(html).toContain("Show builder tools panel");
  });
});

describe("AgentStudioRightPanel", () => {
  test("renders documents content via workspace sidebar", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(AgentStudioRightPanel, {
          model: {
            kind: "documents",
            documentsModel: {
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
          },
        }),
      ),
    );

    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
  });

  test("renders builder tools panel with git and dev server content", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(AgentStudioRightPanel, {
          model: {
            kind: "build_tools",
            diffModel,
            devServerModel,
          },
        }),
      ),
    );

    expect(html).toContain("Current");
    expect(html).toContain("Target");
    expect(html).toContain("origin/main");
    expect(html).toContain("Stop");
    expect(html).toContain("agent-studio-dev-server-terminal");
  });
});
