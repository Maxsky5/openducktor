import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceRecord,
  type WorkspaceRuntimeMcpCheck,
} from "@openducktor/contracts";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
  createObservedCheckFixture,
  createTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { CheckRead } from "@/types/diagnostics";
import {
  type BuildDiagnosticsPanelModelInput,
  buildDiagnosticsPanelModel,
} from "./diagnostics-panel-model";
import { NO_WORKSPACE_MESSAGE } from "./diagnostics-workspace-model";

const createWorkspace = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  workspaceId: "workspace-a",
  workspaceName: "Repo A",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repo-a",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/worktrees",
  defaultWorktreeBasePath: "/worktrees",
  effectiveWorktreeBasePath: "/worktrees",
  ...overrides,
});

const createMcpCheck = (
  repoPath: string,
  runtimes: WorkspaceRuntimeMcpCheck["runtimes"] = [],
  error: string | null = null,
): CheckRead<WorkspaceRuntimeMcpCheck> => ({
  data: {
    repoPath,
    checkedAt: "2026-02-22T08:00:00.000Z",
    runtimes,
  },
  error,
});

const CLI_TOOLS_CHECK = {
  pathOk: true,
  gitOk: true,
  gitVersion: "git version 2.50.1",
  runtimes: [],
  errors: [],
};

const MCP_BRIDGE_CHECK = {
  state: "ready",
  hostUrl: "http://127.0.0.1:1",
  checkedAt: "2026-02-22T08:00:00.000Z",
  detail: null,
} as const;

const createInput = (
  overrides: Partial<BuildDiagnosticsPanelModelInput> = {},
): BuildDiagnosticsPanelModelInput => ({
  runtimeDefinitions: [
    OPENCODE_RUNTIME_DESCRIPTOR,
    CODEX_RUNTIME_DESCRIPTOR,
    CLAUDE_RUNTIME_DESCRIPTOR,
  ],
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  runtimeStatus: createHostRuntimeStatusContextValue(),
  runtimeCheck: createObservedCheckFixture({ data: CLI_TOOLS_CHECK }),
  hostMcpBridgeCheck: { data: MCP_BRIDGE_CHECK, error: null },
  workspace: createWorkspace(),
  checksRepoPath: "/repo-a",
  taskStoreCheck: createObservedCheckFixture({ data: createTaskStoreCheckFixture() }),
  workspaceRuntimeMcpCheck: createMcpCheck("/repo-a"),
  ...overrides,
});

const failedStatus = (kind: "opencode" | "codex" | "claude", enabled = true) =>
  createHostRuntimeStatusFixture({
    kind,
    enabled,
    state: "error",
    failure: {
      trigger: "host_startup",
      phase: "start",
      message: `${kind} failed to start.`,
      nextAction: "Fix the executable path in Settings.",
      occurredAt: "2026-02-22T08:00:00.000Z",
    },
  });

describe("buildDiagnosticsPanelModel", () => {
  test("lists every supported runtime kind in a stable order, including disabled kinds", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            claude: createHostRuntimeStatusFixture({ kind: "claude" }),
            codex: createHostRuntimeStatusFixture({
              kind: "codex",
              enabled: false,
              state: "disabled",
              runtimeId: null,
            }),
            opencode: createHostRuntimeStatusFixture({ kind: "opencode", version: null }),
          },
        }),
      }),
    );

    expect(model.host.runtimes.entries.map((entry) => entry.kind)).toEqual([
      "opencode",
      "codex",
      "claude",
    ]);
    const [opencode, codex] = model.host.runtimes.entries;
    expect(opencode?.status).toEqual({ health: "ok", label: "Ready" });
    expect(opencode?.action).toEqual({ type: "restart", label: "Restart" });
    expect(codex?.status.label).toBe("Disabled");
    expect(codex?.action).toEqual({ type: "open_settings" });
    expect(model.hasHostBlockingFailure).toBe(false);
    expect(model.summaryState.label).toBe("Healthy");
  });

  test("offers restart for a failed kind and retry apply for a saved disable that did not stop", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            opencode: failedStatus("opencode"),
            codex: failedStatus("codex", false),
            claude: createHostRuntimeStatusFixture({ kind: "claude" }),
          },
        }),
      }),
    );

    const [opencode, codex] = model.host.runtimes.entries;
    expect(opencode?.action).toEqual({ type: "restart", label: "Restart" });
    expect(opencode?.failure).toEqual({
      stage: "Start",
      message: "opencode failed to start.",
      nextAction: "Fix the executable path in Settings.",
    });
    expect(codex?.action).toEqual({ type: "restart", label: "Retry apply" });
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("shows the effective executable only when it differs from the configured one", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            opencode: createHostRuntimeStatusFixture({
              kind: "opencode",
              configuredExecutablePath: "opencode",
              effectiveExecutablePath: "/usr/local/bin/opencode",
              version: "1.18.34",
            }),
          },
        }),
      }),
    );

    expect(model.host.runtimes.entries[0]?.rows.map((row) => row.label)).toEqual([
      "Enabled",
      "Configured executable",
      "Effective executable",
      "Version",
    ]);
  });

  test("marks runtime state as not current when live updates stopped", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          isCurrent: false,
          streamError: "Connection lost.",
        }),
      }),
    );

    expect(model.host.runtimes.status).toEqual({ health: "failed", label: "Not current" });
    expect(model.host.runtimes.notice).toContain("earlier results");
    expect(model.hasHostBlockingFailure).toBe(true);
  });

  test("keeps host checks without a workspace and shows the workspace message", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        workspace: null,
        checksRepoPath: null,
        taskStoreCheck: createObservedCheckFixture(),
        workspaceRuntimeMcpCheck: { data: null, error: null },
      }),
    );

    expect(model.workspace).toEqual({ kind: "none", emptyMessage: NO_WORKSPACE_MESSAGE });
    expect(model.host.runtimes.entries).toHaveLength(3);
    expect(model.summaryState.label).toBe("Healthy");
  });

  test("does not let a workspace switch clear a host failure", () => {
    const runtimeStatus = createHostRuntimeStatusContextValue({
      statusByKind: { opencode: failedStatus("opencode") },
    });
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus,
        workspace: createWorkspace({ workspaceId: "workspace-b", repoPath: "/repo-b" }),
        checksRepoPath: "/repo-b",
        workspaceRuntimeMcpCheck: createMcpCheck("/repo-b"),
      }),
    );

    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.hasWorkspaceBlockingFailure).toBe(false);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("never shows another workspace's checks under the selected workspace label", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        workspace: createWorkspace({ workspaceName: "Repo B", repoPath: "/repo-b" }),
        checksRepoPath: "/repo-a",
        workspaceRuntimeMcpCheck: createMcpCheck("/repo-a"),
      }),
    );

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    expect(model.workspace.name).toBe("Repo B");
    expect(model.workspace.taskStore.status.label).toBe("Loading");
    expect(model.workspace.runtimeMcp.status.label).toBe("Loading");
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("shows MCP connections as not checked, unsupported, or failed per observed directory", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        workspaceRuntimeMcpCheck: createMcpCheck("/repo-a", [
          {
            kind: "opencode",
            state: "observed",
            runtimeId: "opencode-runtime-1",
            observations: [
              {
                workingDirectory: "/repo-a",
                state: "connected",
                serverStatus: "connected",
                toolIds: ["odt_read_task"],
                detail: null,
              },
              {
                workingDirectory: "/worktrees/task-1",
                state: "failed",
                serverStatus: null,
                toolIds: [],
                detail: "Tools are missing.",
              },
            ],
            detail: null,
          },
          {
            kind: "codex",
            state: "not_checked",
            runtimeId: null,
            observations: [],
            detail: null,
          },
          {
            kind: "claude",
            state: "unsupported",
            runtimeId: null,
            observations: [],
            detail: null,
          },
        ]),
      }),
    );

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    const [opencode, codex, claude] = model.workspace.runtimeMcp.entries;
    expect(opencode?.status.label).toBe("Failed");
    expect(opencode?.observations.map((observation) => observation.status.label)).toEqual([
      "Connected",
      "Failed",
    ]);
    expect(codex?.status.label).toBe("Not checked");
    expect(claude?.status.label).toBe("Unsupported");
    expect(model.workspace.runtimeMcp.errors).toEqual([
      "OpenCode in /worktrees/task-1: Tools are missing.",
    ]);
    expect(model.hasWorkspaceBlockingFailure).toBe(true);
    expect(model.hasHostBlockingFailure).toBe(false);
  });

  test("shows failed CLI and task-store refreshes over cached successes as current failures", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeCheck: {
          data: CLI_TOOLS_CHECK,
          error: "Runtime check failed.",
          failureKind: "error",
          observedAt: "2026-02-22T07:00:00.000Z",
        },
        taskStoreCheck: {
          data: createTaskStoreCheckFixture(),
          error: "Task store check failed.",
          failureKind: "error",
          observedAt: "2026-02-22T07:30:00.000Z",
        },
      }),
    );

    const { cliTools } = model.host;
    expect(cliTools.status).toEqual({ health: "failed", label: "Check failed" });
    expect(cliTools.errors).toEqual([
      "CLI tools check failed: Runtime check failed. Select Refresh Checks to try again.",
    ]);
    expect(cliTools.notice).toBe(
      "Earlier result from 2026-02-22T07:00:00.000Z. It may not be current.",
    );
    expect(cliTools.rows[0]).toEqual({ label: "Git", value: "git version 2.50.1" });

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    const { taskStore } = model.workspace;
    expect(taskStore.status).toEqual({ health: "failed", label: "Check failed" });
    expect(taskStore.errors).toEqual([
      "Task store check failed: Task store check failed. Select Refresh Checks to try again.",
    ]);
    expect(taskStore.notice).toBe(
      "Earlier result from 2026-02-22T07:30:00.000Z. It may not be current.",
    );
    expect(taskStore.rows.map((row) => row.label)).toEqual([
      "Status",
      "Health category",
      "SQLite database path",
    ]);

    expect(model.criticalReasons).toEqual([...cliTools.errors, ...taskStore.errors]);
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.hasWorkspaceBlockingFailure).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("shows no earlier result when a failed check was never observed", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeCheck: {
          data: {
            pathOk: false,
            gitOk: false,
            gitVersion: null,
            runtimes: [],
            errors: ["Timed out."],
          },
          error: "Timed out.",
          failureKind: "timeout",
          observedAt: null,
        },
      }),
    );

    expect(model.host.cliTools.status).toEqual({ health: "failed", label: "Timed out" });
    expect(model.host.cliTools.rows).toEqual([]);
    expect(model.host.cliTools.notice).toBeUndefined();
    expect(model.hasHostBlockingFailure).toBe(true);
  });

  test("shows failed MCP bridge and connection refreshes over cached successes as current failures", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        hostMcpBridgeCheck: { data: MCP_BRIDGE_CHECK, error: "Bridge check failed." },
        workspaceRuntimeMcpCheck: createMcpCheck(
          "/repo-a",
          [
            {
              kind: "opencode",
              state: "observed",
              runtimeId: "opencode-runtime-1",
              observations: [
                {
                  workingDirectory: "/repo-a",
                  state: "connected",
                  serverStatus: "connected",
                  toolIds: ["odt_read_task"],
                  detail: null,
                },
              ],
              detail: null,
            },
          ],
          "Connection check failed.",
        ),
      }),
    );

    const { mcpBridge } = model.host;
    expect(mcpBridge.status).toEqual({ health: "failed", label: "Check failed" });
    expect(mcpBridge.errors).toEqual([
      "OpenDucktor MCP bridge check failed: Bridge check failed. Select Refresh Checks to try again.",
    ]);
    expect(mcpBridge.notice).toBe(
      "Earlier result from 2026-02-22T08:00:00.000Z. It may not be current.",
    );
    expect(mcpBridge.rows.map((row) => row.label)).toEqual(["Host URL", "Checked at"]);

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    const { runtimeMcp } = model.workspace;
    expect(runtimeMcp.status).toEqual({ health: "failed", label: "Check failed" });
    expect(runtimeMcp.errors).toEqual([
      "Runtime OpenDucktor MCP connections check failed: Connection check failed. Select Refresh Checks to try again.",
    ]);
    expect(runtimeMcp.notice).toBe(
      "Earlier result from 2026-02-22T08:00:00.000Z. It may not be current.",
    );
    expect(runtimeMcp.entries[0]?.status.label).toBe("Connected");

    expect(model.criticalReasons).toEqual([...mcpBridge.errors, ...runtimeMcp.errors]);
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.hasWorkspaceBlockingFailure).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("does not show MCP connections of a replaced runtime as current", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            opencode: createHostRuntimeStatusFixture({ kind: "opencode", runtimeId: "opencode-2" }),
          },
        }),
        workspaceRuntimeMcpCheck: createMcpCheck("/repo-a", [
          {
            kind: "opencode",
            state: "observed",
            runtimeId: "opencode-1",
            observations: [
              {
                workingDirectory: "/repo-a",
                state: "connected",
                serverStatus: "connected",
                toolIds: ["odt_read_task"],
                detail: null,
              },
            ],
            detail: null,
          },
        ]),
      }),
    );

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    const { runtimeMcp } = model.workspace;
    expect(runtimeMcp.entries).toEqual([
      {
        kind: "opencode",
        label: "OpenCode",
        status: { health: "neutral", label: "Unavailable" },
        detail:
          "These connections were observed on an earlier runtime. Refresh checks to observe the current runtime.",
        observations: [],
      },
    ]);
    expect(runtimeMcp.status).toEqual({ health: "neutral", label: "Not checked" });
  });

  test("treats unobserved MCP as not blocking and puts setup warnings after loading", () => {
    const warningModel = buildDiagnosticsPanelModel(
      createInput({
        workspace: createWorkspace({ effectiveWorktreeBasePath: null }),
        workspaceRuntimeMcpCheck: createMcpCheck("/repo-a", [
          {
            kind: "opencode",
            state: "not_checked",
            runtimeId: null,
            observations: [],
            detail: null,
          },
        ]),
      }),
    );
    expect(warningModel.summaryState.label).toBe("Setup needed");

    const loadingModel = buildDiagnosticsPanelModel(
      createInput({
        workspace: createWorkspace({ effectiveWorktreeBasePath: null }),
        runtimeStatus: createHostRuntimeStatusContextValue({ isLoading: true, isCurrent: false }),
      }),
    );
    expect(loadingModel.summaryState.label).toBe("Checking...");
  });
});
