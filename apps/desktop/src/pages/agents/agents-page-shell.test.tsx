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
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("restore failed");
    expect(html).not.toContain("workspace");
  });

  test("renders the workspace when no navigation error is present", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsPageShell, {
        activeRepo: "/repo",
        navigationPersistenceError: null,
        activeTabValue: "task-1",
        onRetryNavigationPersistence: () => {},
        onTabValueChange: () => {},
        taskTabs: createElement("div", undefined, "tabs"),
        workspace: createElement("div", undefined, "workspace"),
      }),
    );

    expect(html).toContain("workspace");
    expect(html).toContain("tabs");
  });
});
