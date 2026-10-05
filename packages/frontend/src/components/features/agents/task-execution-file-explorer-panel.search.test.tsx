import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { WorkspaceFileTree, WorkspaceFileTreeEntry } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { workspaceFileTreeQueryOptions } from "@/state/queries/filesystem";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";

enableReactActEnvironment();

const actualThemeProvider = await import("@/components/layout/theme-provider");
let themeSpy: { mockRestore(): void } | null = null;

const ROOT_PATH = "/repo";

const entry = (kind: WorkspaceFileTreeEntry["kind"], path: string): WorkspaceFileTreeEntry => ({
  kind,
  path,
  size: kind === "file" ? 24 : null,
  mtimeMs: null,
  gitStatus: null,
});

const TREE: WorkspaceFileTree = {
  rootPath: ROOT_PATH,
  entries: [
    entry("directory", "src"),
    entry("file", "src/app.ts"),
    entry("directory", "src/lib"),
    entry("file", "src/lib/util.ts"),
    entry("file", "README.md"),
  ],
};

beforeEach(() => {
  themeSpy = spyOn(actualThemeProvider, "useTheme").mockImplementation(() => ({
    theme: "light",
    themePreference: "light",
    setThemePreference: () => {},
  }));
});

afterEach(() => {
  cleanup();
  themeSpy?.mockRestore();
  themeSpy = null;
});

const renderPanel = () => {
  const client = createQueryClient();
  client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, TREE);
  render(
    <QueryClientProvider client={client}>
      <TaskExecutionFileExplorerPanel
        model={{
          rootPath: ROOT_PATH,
          targetBranch: null,
          unavailableReason: null,
          isActive: false,
          selectedFile: null,
          onSelectFile: () => {},
        }}
      />
    </QueryClientProvider>,
  );
  return client;
};

// Pierre Trees renders the tree in a shadow root and updates it after a task.
const flushTree = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const treeRowPaths = (): string[] =>
  Array.from(
    screen
      .getByLabelText("Workspace file explorer")
      .shadowRoot?.querySelectorAll('[role="treeitem"]') ?? [],
    (row) => row.getAttribute("data-item-path") ?? "",
  );

const searchField = (): HTMLElement => screen.getByRole("textbox", { name: "Search files" });

describe("TaskExecutionFileExplorerPanel search", () => {
  test.each(["util", "added"])(
    "updates an open search for %s after file paths change",
    async (query) => {
      const client = renderPanel();
      await flushTree();
      fireEvent.change(searchField(), { target: { value: query } });
      await flushTree();

      await act(async () => {
        client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
          ...TREE,
          entries: [
            ...TREE.entries.filter((item) => item.path !== "src/lib/util.ts"),
            entry("file", `src/lib/${query}-next.ts`),
          ],
        });
      });
      await flushTree();

      expect(searchField()).toHaveProperty("value", query);
      expect(treeRowPaths()).toEqual(["src/", "src/lib/", `src/lib/${query}-next.ts`]);
    },
  );

  test("filters the tree with the shared search field instead of the Pierre Trees input", async () => {
    renderPanel();
    await flushTree();
    const shadowRoot = screen.getByLabelText("Workspace file explorer").shadowRoot;
    expect(shadowRoot?.querySelector("[data-file-tree-search-input]")).toBeNull();
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);

    fireEvent.change(searchField(), { target: { value: "util" } });
    await flushTree();

    expect(treeRowPaths()).toEqual(["src/", "src/lib/", "src/lib/util.ts"]);
  });

  test("shows the whole tree again after the clear button or Escape", async () => {
    renderPanel();
    await flushTree();

    fireEvent.change(searchField(), { target: { value: "util" } });
    await flushTree();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await flushTree();
    expect(searchField()).toHaveProperty("value", "");
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);

    fireEvent.change(searchField(), { target: { value: "util" } });
    await flushTree();
    fireEvent.keyDown(searchField(), { key: "Escape" });
    await flushTree();
    expect(searchField()).toHaveProperty("value", "");
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);
  });
});
