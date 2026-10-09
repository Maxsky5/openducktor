import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  type HostMcpBridgeStatus,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import {
  createHostMcpBridgeStatusFixture,
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
  createObservedCheckFixture,
  createTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import {
  type BuildDiagnosticsPanelModelInput,
  buildDiagnosticsPanelModel,
  type DiagnosticsCheckModel,
  type DiagnosticsPanelModel,
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

const GIT_CHECK = {
  ok: true,
  executablePath: "/bin/git",
  version: "git version 2.50.1",
  error: null,
};

const BRIDGE_FAILURE =
  "The OpenDucktor MCP host bridge did not start: Port in use. Fix the cause, then restart OpenDucktor.";

/** Host status whose snapshot carries the given MCP bridge status. */
const withMcpBridge = (
  mcpBridge: HostMcpBridgeStatus,
  overrides: Parameters<typeof createHostRuntimeStatusContextValue>[0] = {},
) => {
  const value = createHostRuntimeStatusContextValue(overrides);
  return value.snapshot === null ? value : { ...value, snapshot: { ...value.snapshot, mcpBridge } };
};

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
  pathCheck: createObservedCheckFixture({ data: { ok: true, error: null } }),
  gitCheck: createObservedCheckFixture({ data: GIT_CHECK }),
  workspace: createWorkspace(),
  checksRepoPath: "/repo-a",
  taskStoreCheck: createObservedCheckFixture({ data: createTaskStoreCheckFixture() }),
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

const hostCheck = (model: DiagnosticsPanelModel, key: string): DiagnosticsCheckModel => {
  const check = model.host.tools.find((candidate) => candidate.key === key);
  if (!check) throw new Error(`Missing host check ${key}.`);
  return check;
};

const workspaceCheck = (model: DiagnosticsPanelModel, key: string): DiagnosticsCheckModel => {
  if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
  const check = model.workspace.checks.find((candidate) => candidate.key === key);
  if (!check) throw new Error(`Missing workspace check ${key}.`);
  return check;
};

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
      message: "opencode failed to start.",
      nextAction: "Fix the executable path in Settings.",
    });
    expect(codex?.action).toEqual({ type: "restart", label: "Retry apply" });
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
    // The row shows the full cause. The overview lists a short issue for each runtime.
    expect(model.overview).toEqual({
      tone: "critical",
      title: "2 issues need attention",
      description: "Fix these issues so agent sessions can run.",
      issues: [
        { scope: "host", message: "The OpenCode runtime could not start." },
        { scope: "host", message: "The Codex runtime could not start." },
      ],
    });
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

    expect(model.host.runtimes.entries[0]).toMatchObject({
      executablePath: "opencode",
      effectiveExecutablePath: "/usr/local/bin/opencode",
      version: "1.18.34",
    });

    const samePath = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            opencode: createHostRuntimeStatusFixture({
              kind: "opencode",
              configuredExecutablePath: "/usr/local/bin/opencode",
              effectiveExecutablePath: "/usr/local/bin/opencode",
            }),
          },
        }),
      }),
    );
    expect(samePath.host.runtimes.entries[0]?.effectiveExecutablePath).toBeNull();
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

    expect(model.host.runtimes.notice).toBe(
      "Live runtime updates stopped: Connection lost. These states can be out of date. Select Refresh to read them again.",
    );
    expect(model.hasHostBlockingFailure).toBe(true);
  });

  test("keeps host checks without a workspace and shows the workspace message", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        workspace: null,
        checksRepoPath: null,
        taskStoreCheck: createObservedCheckFixture(),
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
      }),
    );

    if (model.workspace.kind !== "selected") throw new Error("Expected a selected workspace.");
    expect(model.workspace.name).toBe("Repo B");
    expect(workspaceCheck(model, "task-store").status.label).toBe("Checking");
    expect(model.summaryState.label).toBe("Checking...");
    expect(model.overview.tone).toBe("checking");
  });

  test("runtime and settings failures leave PATH and Git rows healthy", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeDefinitionsError: "Settings could not be read.",
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: { opencode: failedStatus("opencode") },
        }),
      }),
    );
    expect(hostCheck(model, "path").status).toEqual({ health: "ok", label: "Available" });
    expect(hostCheck(model, "git").status).toEqual({ health: "ok", label: "Available" });
    expect(hostCheck(model, "git").errors).toEqual([]);
    expect(model.host.runtimes.entries[0]?.version).toBeNull();
  });

  test("a PATH failure does not change the Git result", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        pathCheck: createObservedCheckFixture({
          data: { ok: false, error: "Shell startup failed." },
        }),
      }),
    );
    expect(hostCheck(model, "path").errors).toEqual(["Shell startup failed."]);
    expect(hostCheck(model, "git").status.health).toBe("ok");
    expect(hostCheck(model, "git").errors).toEqual([]);
  });

  test("shows failed Git and task-store reads with their earlier results", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        gitCheck: {
          data: GIT_CHECK,
          error: "Git read failed.",
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

    const git = hostCheck(model, "git");
    expect(git.status).toEqual({ health: "failed", label: "Check unavailable" });
    expect(git.errors).toEqual([
      "Git check could not be read: Git read failed. Select Refresh to try again.",
    ]);
    expect(git.notice).toStartWith("Showing the result from ");
    expect(git.notice).toEndWith(". It may be out of date.");
    expect(git.value).toBe("2.50.1");

    const taskStore = workspaceCheck(model, "task-store");
    expect(taskStore.status).toEqual({ health: "failed", label: "Check unavailable" });
    expect(taskStore.errors).toEqual([
      "Task store check could not be read: Task store check failed. Select Refresh to try again.",
    ]);
    expect(taskStore.notice).toEndWith(". It may be out of date.");
    // Each notice names the time of its own check.
    expect(taskStore.notice).not.toBe(git.notice);
    expect(taskStore.details.map((detail) => detail.label)).toEqual(["Database"]);

    expect(model.criticalReasons).toEqual([...git.errors, ...taskStore.errors]);
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.hasWorkspaceBlockingFailure).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("shows no earlier result when a failed check was never observed", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        gitCheck: {
          data: null,
          error: "Timed out.",
          failureKind: "timeout",
          observedAt: null,
        },
      }),
    );

    const git = hostCheck(model, "git");
    expect(git.status).toEqual({ health: "failed", label: "Timed out" });
    expect(git.value).toBeNull();
    expect(git.notice).toBeNull();
    expect(model.hasHostBlockingFailure).toBe(true);
  });

  test("shows the address of a ready MCP bridge", () => {
    const model = buildDiagnosticsPanelModel(createInput());

    const mcpBridge = hostCheck(model, "mcp-bridge");
    expect(mcpBridge.status).toEqual({ health: "ok", label: "Ready" });
    expect(mcpBridge.details).toEqual([
      { label: "Address", value: "http://127.0.0.1:4000", isPath: true },
    ]);
    expect(mcpBridge.errors).toEqual([]);
  });

  test("shows a starting MCP bridge as work in progress, not as an issue", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: withMcpBridge(
          createHostMcpBridgeStatusFixture({ state: "starting", hostUrl: null, revision: 0 }),
        ),
      }),
    );

    expect(hostCheck(model, "mcp-bridge").status).toEqual({ health: "busy", label: "Starting" });
    expect(model.criticalReasons).toEqual([]);
    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("shows a failed MCP bridge start as a critical host issue", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: withMcpBridge(
          createHostMcpBridgeStatusFixture({
            state: "failed",
            hostUrl: null,
            failure: BRIDGE_FAILURE,
          }),
        ),
      }),
    );

    const mcpBridge = hostCheck(model, "mcp-bridge");
    expect(mcpBridge.status).toEqual({ health: "failed", label: "Error" });
    expect(mcpBridge.errors).toEqual([BRIDGE_FAILURE]);
    expect(mcpBridge.details).toEqual([]);
    expect(model.criticalReasons).toEqual([BRIDGE_FAILURE]);
    expect(model.hasHostBlockingFailure).toBe(true);
    expect(model.hasWorkspaceBlockingFailure).toBe(false);
    expect(model.summaryState.label).toBe("Critical issue");
  });

  test("puts a critical issue ahead of a check in progress", () => {
    const model = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: withMcpBridge(
          createHostMcpBridgeStatusFixture({
            state: "failed",
            hostUrl: null,
            failure: BRIDGE_FAILURE,
          }),
          { isLoading: true, isCurrent: false },
        ),
      }),
    );

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.overview.tone).toBe("critical");
  });

  test("puts setup warnings after loading", () => {
    const warningModel = buildDiagnosticsPanelModel(
      createInput({
        workspace: createWorkspace({ effectiveWorktreeBasePath: null }),
      }),
    );
    expect(warningModel.summaryState.label).toBe("Setup needed");
    expect(warningModel.overview).toMatchObject({
      tone: "warning",
      title: "Workspace setup needed",
    });

    const loadingModel = buildDiagnosticsPanelModel(
      createInput({
        workspace: createWorkspace({ effectiveWorktreeBasePath: null }),
        runtimeStatus: createHostRuntimeStatusContextValue({ isLoading: true, isCurrent: false }),
      }),
    );
    expect(loadingModel.summaryState.label).toBe("Checking...");
  });

  test("summarizes a healthy host with and without a workspace", () => {
    const withWorkspace = buildDiagnosticsPanelModel(
      createInput({
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {
            opencode: createHostRuntimeStatusFixture({ kind: "opencode" }),
            codex: createHostRuntimeStatusFixture({ kind: "codex" }),
          },
        }),
      }),
    );
    expect(withWorkspace.overview).toEqual({
      tone: "healthy",
      title: "Everything is working",
      description: "2 runtimes are ready. The workspace checks passed.",
      issues: [],
    });

    const withoutWorkspace = buildDiagnosticsPanelModel(
      createInput({
        workspace: null,
        checksRepoPath: null,
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: { claude: createHostRuntimeStatusFixture({ kind: "claude" }) },
        }),
      }),
    );
    expect(withoutWorkspace.overview.description).toBe("1 runtime is ready.");
  });
});
