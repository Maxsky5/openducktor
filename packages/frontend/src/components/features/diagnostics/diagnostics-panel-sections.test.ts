import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type TaskStoreCheck,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDisabledRuntimeHealth,
  deriveRepoRuntimeHealthState,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { buildDiagnosticsPanelModel as buildDiagnosticsPanelModelBase } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

const buildDiagnosticsPanelModel = (input: Parameters<typeof buildDiagnosticsPanelModelBase>[0]) =>
  buildDiagnosticsPanelModelBase({
    ...input,
    runtimeHealthByRuntime: {
      claude: buildDisabledRuntimeHealth(CLAUDE_RUNTIME_DESCRIPTOR),
      ...input.runtimeHealthByRuntime,
    },
  });

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => {
  const checkedAt = overrides.checkedAt ?? "2026-02-20T12:01:00.000Z";
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  };

  return {
    status: overrides.status ?? deriveRepoRuntimeHealthState({ runtime, mcp }),
    checkedAt,
    runtime,
    mcp,
  };
};

const makeTaskStoreCheck = (overrides: Partial<TaskStoreCheck> = {}): TaskStoreCheck => ({
  taskStoreOk: true,
  taskStorePath: "/Users/dev/.openducktor/task-stores/fairnest/database.sqlite",
  taskStoreError: null,
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: "SQLite task store is ready.",
    databasePath: "/Users/dev/.openducktor/task-stores/fairnest/database.sqlite",
  },
  ...overrides,
});

const makeWorkspace = (
  repoPath: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/Users/dev/worktrees",
  defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/fairnest",
  effectiveWorktreeBasePath: "/Users/dev/worktrees",
  ...overrides,
});

describe("DiagnosticsPanelSections", () => {
  test("renders repository-first empty messages when no repository is selected", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: null,
      activeWorkspace: null,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      taskStoreCheck: null,
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("Select a repository to load diagnostics.");
    expect(html).toContain("Select a repository first.");
  });

  test("renders key-value labels consistently across sections", () => {
    const opencodeValue = "1.2.9 (/Users/dev/.opencode/bin/opencode)";
    const codexValue =
      "codex-cli 0.42.0 (/Applications/OpenDucktor.app/Contents/Resources/bin/codex)";
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/Users/dev/fairnest",
      activeWorkspace: makeWorkspace("/Users/dev/fairnest"),
      runtimeDefinitions: [
        OPENCODE_RUNTIME_DESCRIPTOR,
        CODEX_RUNTIME_DESCRIPTOR,
        CLAUDE_RUNTIME_DESCRIPTOR,
      ],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: [
          { kind: "opencode", ok: true, version: opencodeValue },
          { kind: "codex", enabled: false, ok: true, version: codexValue },
          { kind: "claude", enabled: false, ok: false, version: null },
        ],
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: null,
            instance: {
              kind: "opencode",
              repoPath: "/Users/dev/fairnest",
              taskId: null,
              role: "workspace",
              workingDirectory: "/Users/dev/fairnest",
              startedAt: "2026-02-20T12:00:00.000Z",
              descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            },
          },
          mcp: {
            supported: true,
            status: "connected",
            serverName: "openducktor",
            serverStatus: "connected",
            toolIds: ["openducktor_odt_read_task"],
            detail: null,
            failureKind: null,
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("Repository:");
    expect(html).toContain("Repository path:");
    expect(html).toContain("Worktree directory:");
    expect(html).toContain("Git:");
    expect(html).toContain("GitHub CLI:");
    expect(html).toContain("OpenCode:");
    expect(html).toContain("Codex:");
    expect(html).toContain("Claude:");
    expect(html).toContain(opencodeValue);
    expect(html).toContain(`${codexValue} (runtime disabled)`);
    expect(html).toContain("OpenCode Runtime");
    expect(html).toContain("Working directory:");
    expect(html).toContain("Server name:");
    expect(html).toContain("Status:");
    expect(html).toContain("Tools detected:");
    expect(html).toContain("SQLite database path:");
  });

  test("renders error rows when section errors are present", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/Users/dev/fairnest",
      activeWorkspace: makeWorkspace("/Users/dev/fairnest", {
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      }),
      runtimeDefinitions: [
        OPENCODE_RUNTIME_DESCRIPTOR,
        CODEX_RUNTIME_DESCRIPTOR,
        CLAUDE_RUNTIME_DESCRIPTOR,
      ],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "gh not found in PATH",
        runtimes: [
          { kind: "opencode", ok: false, version: null },
          { kind: "codex", enabled: false, ok: false, version: null },
          { kind: "claude", enabled: false, ok: false, version: null },
        ],
        errors: ["gh not found in PATH"],
      },
      taskStoreCheck: makeTaskStoreCheck({
        taskStoreOk: false,
        taskStorePath: null,
        taskStoreError: "task store failed",
        repoStoreHealth: {
          category: "database_unavailable",
          status: "degraded",
          isReady: false,
          detail: "task store failed",
          databasePath: null,
        },
      }),
      runtimeCheckFailureKind: "error",
      taskStoreCheckFailureKind: "error",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "error",
            stage: "startup_failed",
            observation: null,
            instance: null,
            detail: "runtime failed",
            failureKind: "error",
          },
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "server unavailable",
            failureKind: "error",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("GitHub optional");
    expect(html).not.toContain("gh not found in PATH");
    expect(html).toContain("runtime failed");
    expect(html).not.toContain("server unavailable");
    expect(html).toContain("task store failed");
  });
});
