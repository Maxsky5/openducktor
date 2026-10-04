import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createHostRuntimeStatusContextValue,
  createObservedCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";
import { DiagnosticsStatusBadge } from "./diagnostics-section";

type ModelInput = Parameters<typeof buildDiagnosticsPanelModel>[0];

const renderSections = (workspace: ModelInput["workspace"], overrides: Partial<ModelInput> = {}) =>
  renderToStaticMarkup(
    createElement(DiagnosticsPanelSections, {
      model: buildDiagnosticsPanelModel({
        runtimeDefinitions: [
          OPENCODE_RUNTIME_DESCRIPTOR,
          CODEX_RUNTIME_DESCRIPTOR,
          CLAUDE_RUNTIME_DESCRIPTOR,
        ],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        // No status yet: entries render without lifecycle actions.
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {},
          isLoading: true,
          isCurrent: false,
        }),
        runtimeCheck: createObservedCheckFixture(),
        hostMcpBridgeCheck: { data: null, error: null },
        workspace,
        checksRepoPath: workspace?.repoPath ?? null,
        taskStoreCheck: createObservedCheckFixture(),
        workspaceRuntimeMcpCheck: { data: null, error: null },
        ...overrides,
      }),
    }),
  );

describe("DiagnosticsPanelSections", () => {
  test("renders the host group first and the workspace message without a workspace", () => {
    const html = renderSections(null);

    expect(html.indexOf("Agent runtimes")).toBeGreaterThan(-1);
    expect(html.indexOf("Agent runtimes")).toBeLessThan(html.indexOf("CLI tools"));
    expect(html.indexOf("CLI tools")).toBeLessThan(html.indexOf("OpenDucktor MCP bridge"));
    expect(html.indexOf("OpenDucktor MCP bridge")).toBeLessThan(
      html.indexOf("Select a workspace to view workspace checks."),
    );
    expect(html).toContain("OpenCode");
    expect(html).toContain("Codex");
    expect(html).toContain("Claude");
  });

  test("labels the workspace group with the workspace name and path", () => {
    const html = renderSections({
      workspaceId: "workspace-a",
      workspaceName: "Repo A",
      abbreviation: null,
      tileColor: null,
      repoPath: "/repo-a",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: null,
      effectiveWorktreeBasePath: "/worktrees",
    });

    expect(html).toContain("Workspace: Repo A");
    expect(html).toContain("/repo-a");
    expect(html).toContain("Repository setup");
    expect(html).toContain("Task store");
    expect(html).toContain("Runtime OpenDucktor MCP connections");
  });

  test("labels values kept after a failed refresh as an earlier result", () => {
    const html = renderSections(null, {
      hostMcpBridgeCheck: {
        data: {
          state: "ready",
          hostUrl: "http://127.0.0.1:1",
          checkedAt: "2026-02-22T08:00:00.000Z",
          detail: null,
        },
        error: "Bridge check failed.",
      },
    });

    expect(html).toContain("Earlier result from 2026-02-22T08:00:00.000Z. It may not be current.");
    expect(html).toContain(
      "OpenDucktor MCP bridge check failed: Bridge check failed. Select Refresh Checks to try again.",
    );
  });

  test("maps each check health to a badge tone only when it renders", () => {
    const renderBadge = (status: Parameters<typeof DiagnosticsStatusBadge>[0]["status"]) =>
      renderToStaticMarkup(createElement(DiagnosticsStatusBadge, { status }));

    expect(renderBadge({ health: "failed", label: "Issue" })).toContain("bg-destructive-surface");
    expect(renderBadge({ health: "busy", label: "Starting" })).toContain("bg-warning-surface");
    expect(renderBadge({ health: "ok", label: "Ready" })).toContain("bg-success-surface");
    expect(renderBadge({ health: "loading", label: "Loading" })).toContain("bg-secondary");
  });
});
