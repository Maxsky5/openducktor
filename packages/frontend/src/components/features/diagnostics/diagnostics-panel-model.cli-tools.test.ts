import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { buildDisabledRuntimeHealth } from "@/lib/repo-runtime-health";
import { buildDiagnosticsPanelModel as buildDiagnosticsPanelModelBase } from "./diagnostics-panel-model";
import {
  makeBuiltInRuntimeDefinitions,
  makeBuiltInRuntimeDiagnostics,
  makeRepoHealth,
  makeRuntimeDiagnosticInstance,
  makeTaskStoreCheck,
  makeWorkspace,
} from "./diagnostics-panel-model-test-fixtures";

const buildDiagnosticsPanelModel = (input: Parameters<typeof buildDiagnosticsPanelModelBase>[0]) =>
  buildDiagnosticsPanelModelBase({
    ...input,
    runtimeHealthByRuntime: {
      claude: buildDisabledRuntimeHealth(CLAUDE_RUNTIME_DESCRIPTOR),
      ...input.runtimeHealthByRuntime,
    },
  });

const buildCliToolsModel = ({
  runtimeDefinitions = makeBuiltInRuntimeDefinitions(),
  runtimeDefinitionsError = null,
  runtimes,
}: {
  runtimeDefinitions?: RuntimeDescriptor[];
  runtimeDefinitionsError?: string | null;
  runtimes: RuntimeCheck["runtimes"];
}) =>
  buildDiagnosticsPanelModel({
    workspaceRepoPath: "/repo",
    activeWorkspace: makeWorkspace("/repo"),
    runtimeDefinitions,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError,
    runtimeCheck: {
      gitOk: true,
      gitVersion: "git version 2.50.1",
      ghOk: true,
      ghVersion: "gh version 2.73.0",
      ghAuthOk: true,
      ghAuthLogin: "octocat",
      ghAuthError: null,
      runtimes,
      errors: [],
    },
    taskStoreCheck: makeTaskStoreCheck(),
    runtimeCheckFailureKind: null,
    taskStoreCheckFailureKind: null,
    runtimeHealthByRuntime: {},
    isLoadingChecks: false,
  });

describe("buildDiagnosticsPanelModel CLI Tools", () => {
  test("renders OpenCode, Codex, and Claude CLI paths and versions by runtime kind", () => {
    const opencodeValue = "1.2.9 (/Users/dev/.opencode/bin/opencode)";
    const codexValue =
      "codex-cli 0.42.0 (/Applications/OpenDucktor.app/Contents/Resources/bin/codex)";
    const claudeValue = "2.1.12 (/Users/dev/.local/bin/claude)";
    const model = buildCliToolsModel({
      runtimes: [
        { kind: "codex", ok: true, version: codexValue },
        { kind: "opencode", ok: true, version: opencodeValue },
        { kind: "claude", ok: true, version: claudeValue },
      ],
    });

    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");

    expect(cliToolsSection?.rows).toEqual([
      { label: "Git", value: "git version 2.50.1" },
      { label: "GitHub CLI", value: "gh version 2.73.0" },
      { label: "OpenCode", value: opencodeValue, breakAll: true },
      { label: "Codex", value: codexValue, breakAll: true },
      { label: "Claude", value: claudeValue, breakAll: true },
    ]);
  });

  test.each([
    {
      name: "missing OpenCode and detected Codex",
      runtimes: [
        { kind: "opencode" as const, ok: false, version: null },
        { kind: "codex" as const, ok: true, version: "codex-cli 0.42.0 (/bin/codex)" },
        { kind: "claude" as const, enabled: false, ok: false, version: null },
      ],
      expectedValues: ["missing", "codex-cli 0.42.0 (/bin/codex)", "missing (runtime disabled)"],
    },
    {
      name: "detected OpenCode and missing Codex",
      runtimes: [
        { kind: "opencode" as const, ok: true, version: "1.2.9 (/bin/opencode)" },
        { kind: "codex" as const, ok: false, version: null },
        { kind: "claude" as const, enabled: false, ok: false, version: null },
      ],
      expectedValues: ["1.2.9 (/bin/opencode)", "missing", "missing (runtime disabled)"],
    },
  ])("formats $name independently", ({ runtimes, expectedValues }) => {
    const model = buildCliToolsModel({ runtimes: [...runtimes] });
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");

    expect(cliToolsSection?.rows.slice(2).map((row) => row.value)).toEqual([...expectedValues]);
  });

  test("formats a runtime with no reported version as detected", () => {
    const model = buildCliToolsModel({
      runtimes: [
        { kind: "opencode", ok: true, version: null },
        { kind: "codex", ok: true, version: null },
        { kind: "claude", ok: true, version: null },
      ],
    });
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");

    expect(cliToolsSection?.rows.slice(2).map((row) => row.value)).toEqual([
      "detected",
      "detected",
      "detected",
    ]);
  });

  test("fails when a loaded runtime diagnostic omits an expected runtime", () => {
    expect(() =>
      buildCliToolsModel({
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
      }),
    ).toThrow('Missing CLI diagnostic for runtime kind "codex"');
  });

  test("fails when loaded runtime definitions omit an expected runtime", () => {
    expect(() =>
      buildCliToolsModel({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimes: [
          { kind: "opencode", ok: true, version: "1.2.9" },
          { kind: "codex", ok: true, version: "codex-cli 0.42.0" },
          { kind: "claude", ok: true, version: "2.1.12" },
        ],
      }),
    ).toThrow('Missing runtime definition for runtime kind "codex"');
  });

  test("keeps runtime definition failures authoritative over CLI row invariants", () => {
    const model = buildCliToolsModel({
      runtimeDefinitions: [],
      runtimeDefinitionsError: "Runtime definitions unavailable",
      runtimes: [],
    });
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");

    expect(cliToolsSection?.rows.map((row) => row.label)).toEqual(["Git", "GitHub CLI"]);
    expect(cliToolsSection?.errors).toEqual(["Runtime definitions unavailable"]);
  });

  test("preserves a detected CLI value before the disabled qualifier", () => {
    const codexValue = "codex-cli 0.42.0 (/Applications/OpenDucktor.app/bin/codex)";
    const model = buildCliToolsModel({
      runtimes: [
        { kind: "opencode", ok: true, version: "1.2.9" },
        { kind: "codex", enabled: false, ok: true, version: codexValue },
        { kind: "claude", enabled: false, ok: false, version: null },
      ],
    });
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");

    expect(cliToolsSection?.rows.at(3)).toEqual({
      label: "Codex",
      value: `${codexValue} (runtime disabled)`,
      breakAll: true,
    });
  });

  test("shows timeout-specific CLI tools and task-store states", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: false,
        gitVersion: null,
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "Timed out after 15000ms",
        runtimes: [{ kind: "opencode", ok: false, version: null }],
        errors: ["Timed out after 15000ms"],
      },
      taskStoreCheck: makeTaskStoreCheck({
        taskStoreOk: false,
        taskStorePath: null,
        taskStoreError: "Timed out after 15000ms",
        repoStoreHealth: {
          category: "database_unavailable",
          status: "blocking",
          isReady: false,
          detail: "Timed out after 15000ms",
          databasePath: null,
        },
      }),
      runtimeCheckFailureKind: "timeout",
      taskStoreCheckFailureKind: "timeout",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: [] },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(false);
    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(expect.arrayContaining(["Timed out after 15000ms"]));
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");
    expect(cliToolsSection?.badge).toEqual({ label: "Timed out", variant: "warning" });
    expect(cliToolsSection?.errors[0]).toContain("CLI tools are not yet available");
    expect(cliToolsSection?.rows.map((row) => row.label)).toEqual(["Git", "GitHub CLI"]);
    const taskStoreSection = model.sections.find((section) => section.key === "task-store");
    expect(taskStoreSection?.badge).toEqual({ label: "Timed out", variant: "warning" });
    expect(taskStoreSection?.errors[0]).toContain("Task store is not yet available");
  });

  test("keeps hard runtime failures ahead of timeout summary state", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: false,
        gitVersion: null,
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "Timed out after 15000ms",
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: false, version: null }),
        errors: ["Timed out after 15000ms"],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: "timeout",
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "error",
            stage: "startup_failed",
            observation: null,
            instance: makeRuntimeDiagnosticInstance(),
            startedAt: makeRuntimeDiagnosticInstance().startedAt,
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: 20_000,
            attempts: 4,
            detail: "runtime failed",
            failureKind: "error",
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "waiting_for_runtime",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Runtime is unavailable, so MCP cannot be verified.",
            failureKind: "timeout",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(false);
    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(expect.arrayContaining(["runtime failed"]));
  });

  test("treats GitHub CLI auth failures as optional warnings", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "gh auth missing",
        runtimes: makeBuiltInRuntimeDiagnostics({
          kind: "opencode",
          ok: true,
          version: "1.2.9",
        }),
        errors: ["gh auth missing"],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: [] },
        }),
      },
      isLoadingChecks: false,
    });

    expect(model.criticalReasons).not.toContain("gh auth missing");
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");
    expect(cliToolsSection?.badge).toEqual({ label: "GitHub optional", variant: "warning" });
    expect(cliToolsSection?.errors).toEqual([]);
  });
});
