import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { enableReactActEnvironment } from "./agent-studio-test-utils";

enableReactActEnvironment();

mock.module("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }): ReactElement =>
    createElement("button", { type: "button", onClick }, children),
}));

mock.module("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-tabs", undefined, children),
  TabsContent: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-tabs-content", undefined, children),
}));

type AgentsPageShellComponent = typeof import("./agents-page-shell")["AgentsPageShell"];

let AgentsPageShell: AgentsPageShellComponent;

const flattenText = (value: ReactNode): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => flattenText(entry)).join("");
  }
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  return String(value);
};

beforeAll(async () => {
  ({ AgentsPageShell } = await import("./agents-page-shell"));
});

describe("AgentsPageShell", () => {
  test("renders the navigation restore error state instead of the workspace", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
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
    });

    try {
      const paragraphs = renderer.root.findAllByType("p");
      const rendered = paragraphs.map((entry) => flattenText(entry.props.children)).join(" ");
      expect(rendered.includes("restore failed")).toBe(true);
      expect(rendered.includes("workspace")).toBe(false);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  test("renders the workspace when no navigation error is present", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
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
    });

    try {
      const rendered = renderer.root
        .findAllByType("div")
        .map((entry) => flattenText(entry.props.children))
        .join(" ");
      expect(rendered.includes("workspace")).toBe(true);
      expect(rendered.includes("tabs")).toBe(true);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});
