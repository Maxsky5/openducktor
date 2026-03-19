import { describe, expect, test } from "bun:test";
import type { DevServerScriptState } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStudioDevServerPanelModel } from "./agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import {
  AgentStudioRightPanel,
  AgentStudioRightPanelToggleButton,
} from "./agent-studio-right-panel";

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

const diffModel: AgentStudioGitPanelModel = {
  contextMode: "worktree",
  branch: "feature/task-12",
  worktreePath: "/tmp/worktree/task-12",
  targetBranch: "origin/main",
  diffScope: "target",
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
  selectedFile: null,
  setSelectedFile: () => {},
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
  bufferedLogLines: [
    {
      scriptId: "frontend",
      stream: "stdout",
      text: "ready in 120ms",
      timestamp: "2026-03-19T10:00:01.000Z",
    },
  ],
};

const devServerModel: AgentStudioDevServerPanelModel = {
  mode: "active",
  isExpanded: true,
  isLoading: false,
  repoPath: "/repo",
  taskId: "task-12",
  worktreePath: "/tmp/worktree/task-12",
  scripts: [selectedScript],
  selectedScriptId: selectedScript.scriptId,
  selectedScript,
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
    );

    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
  });

  test("renders builder tools panel with git and dev server content", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioRightPanel, {
        model: {
          kind: "build_tools",
          diffModel,
          devServerModel,
        },
      }),
    );

    expect(html).toContain("Current");
    expect(html).toContain("Target");
    expect(html).toContain("origin/main");
    expect(html).toContain("Builder dev servers");
    expect(html).toContain("ready in 120ms");
  });
});
