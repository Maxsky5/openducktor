import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentsPageShell } from "./agents-page-shell";

describe("AgentsPageShell", () => {
  test("renders the navigation restore error state instead of the workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeRepo: "/repo",
        navigationPersistenceError: new Error("restore failed"),
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
        activeRepo: null,
        navigationPersistenceError: new Error("restore failed"),
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
        activeRepo: "/repo",
        navigationPersistenceError: null,
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

  test("renders a retryable chat settings error banner without hiding the workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeRepo: "/repo",
        navigationPersistenceError: null,
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
