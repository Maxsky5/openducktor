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
        chatSettingsLoadError: null,
        gitProviderContextLoadError: null,
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onRetryGitProviderContext: () => {},
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
        chatSettingsLoadError: null,
        gitProviderContextLoadError: null,
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onRetryGitProviderContext: () => {},
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
        chatSettingsLoadError: null,
        gitProviderContextLoadError: null,
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onRetryGitProviderContext: () => {},
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("workspace");
    expect(html).not.toContain('role="tablist"');
  });

  test("renders a retryable chat settings error banner without hiding the workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: null,
        chatSettingsLoadError: new Error("settings read failed"),
        gitProviderContextLoadError: null,
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onRetryGitProviderContext: () => {},
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("Task sessions couldn&#x27;t load chat settings.");
    expect(html).toContain("settings read failed");
    expect(html).toContain("Retry load");
    expect(html).toContain("workspace");
  });

  test("renders a retryable Git provider error without hiding Agent Studio", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeWorkspace: createActiveWorkspace("/repo"),
        navigationPersistenceError: null,
        chatSettingsLoadError: null,
        gitProviderContextLoadError: new Error("provider context read failed"),
        onRetryNavigationPersistence: () => {},
        onRetryChatSettingsLoad: () => {},
        onRetryGitProviderContext: () => {},
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("Task sessions couldn&#x27;t load Git provider features.");
    expect(html).toContain("provider context read failed");
    expect(html).toContain("Retry provider load");
    expect(html).toContain("workspace");
  });
});
