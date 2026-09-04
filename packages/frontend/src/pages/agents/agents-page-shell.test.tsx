import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentsPageShell } from "./agents-page-shell";

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

describe("AgentsPageShell", () => {
  test("renders the navigation restore error state instead of the workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: new Error("restore failed"),
        isRestoring: false,
        chatSettingsLoadError: null,
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("restore failed");
    expect(html).not.toContain("workspace");
  });

  test("omits the repository label when no active repo is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: null,
        navigationPersistenceError: new Error("restore failed"),
        isRestoring: false,
        chatSettingsLoadError: null,
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).not.toContain("Repository: null");
  });

  test("renders the workspace when no navigation error is present", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: null,
        isRestoring: false,
        chatSettingsLoadError: null,
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("workspace");
    expect(html).toContain("tabs");
  });

  test("hides the empty workspace while saved state loads", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: null,
        isRestoring: true,
        chatSettingsLoadError: null,
        activeTabValue: "__empty__",
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("p", undefined, "Open a task tab to start working with an agent."),
        workspace: createElement("p", undefined, "Open a task tab to start a workspace."),
      }),
    );

    expect(html).toContain("Restoring Agent Studio");
    expect(html).not.toContain("Open a task tab");
  });

  test("renders a retryable chat settings error banner without hiding the workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: null,
        isRestoring: false,
        chatSettingsLoadError: new Error("settings read failed"),
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("Agent Studio couldn&#x27;t load chat settings.");
    expect(html).toContain("settings read failed");
    expect(html).toContain("Retry load");
    expect(html).toContain("workspace");
  });
});
