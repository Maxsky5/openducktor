import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { WorkspaceFileTree, WorkspaceFileTreeEntry } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createQueryClient } from "@/lib/query-client";
import { workspaceFileTreeQueryOptions } from "@/state/queries/filesystem";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";
import { SessionPanel } from "@/features/session-panels";
import { createSessionPanelFixture } from "@/test-utils/session-panel-fixtures";

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
  function Tools({ rootPath }: { rootPath: string }) {
    const [activeTabId, setActiveTabId] = useState("files");
    const explorer = (
      <TaskExecutionFileExplorerPanel
        model={{
          rootPath,
          targetBranch: null,
          unavailableReason: null,
          isActive: false,
          selectedFile: null,
          onSelectFile: () => {},
        }}
      />
    );
    return (
      <SessionPanel
        model={createSessionPanelFixture({
          selectedTabId: activeTabId,
          onSelect: setActiveTabId,
        })}
        toolTabs={{ diffs: { content: <div>Git changes</div> }, files: { content: explorer } }}
      />
    );
  }
  const panel = (rootPath: string) => (
    <QueryClientProvider client={client}>
      <Tools rootPath={rootPath} />
    </QueryClientProvider>
  );
  const view = render(panel(ROOT_PATH));
  return { client, setRootPath: (rootPath: string) => view.rerender(panel(rootPath)) };
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

const clickRow = async (path: string): Promise<void> => {
  const row = screen
    .getByLabelText("Workspace file explorer")
    .shadowRoot?.querySelector(`[role="treeitem"][data-item-path="${path}"]`);
  if (!row) throw new Error(`Tree row not found: ${path}`);
  fireEvent.click(row);
  await flushTree();
};

describe("TaskExecutionFileExplorerPanel", () => {
  test("keeps open folders when switching to Git and back", async () => {
    renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Diffs" }), { button: 0 });
    await flushTree();
    expect(screen.queryByRole("textbox", { name: "Search files" })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }), { button: 0 });
    await flushTree();
    expect(treeRowPaths()).toContain("src/lib/util.ts");
  });

  test("keeps open folders while a full refresh replaces the cached tree", async () => {
    const { client } = renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    await act(async () => {
      await client.resetQueries({
        queryKey: workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey,
      });
    });
    await flushTree();
    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, TREE);
    });
    await flushTree();
    expect(treeRowPaths()).toContain("src/lib/util.ts");
  });

  test("keeps open folders open through file additions, renames, and removals", async () => {
    const { client } = renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    expect(treeRowPaths()).toContain("src/lib/util.ts");

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
        ...TREE,
        entries: [
          ...TREE.entries,
          entry("file", "src/lib/added.ts"),
          entry("directory", "src/added"),
          entry("file", "src/added/hidden.ts"),
        ],
      });
    });
    await flushTree();

    expect(treeRowPaths()).toContain("src/lib/util.ts");
    expect(treeRowPaths()).toContain("src/lib/added.ts");
    expect(treeRowPaths()).toContain("src/added/");
    expect(treeRowPaths()).not.toContain("src/added/hidden.ts");

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
        ...TREE,
        entries: [
          ...TREE.entries.filter((item) => item.path !== "src/lib/util.ts"),
          entry("file", "src/lib/renamed.ts"),
        ],
      });
    });
    await flushTree();
    expect(treeRowPaths()).toContain("src/lib/renamed.ts");
    expect(treeRowPaths()).not.toContain("src/lib/added.ts");
    expect(treeRowPaths()).not.toContain("src/lib/util.ts");

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
        ...TREE,
        entries: TREE.entries.filter((item) => !item.path.startsWith("src/lib")),
      });
    });
    await flushTree();
    expect(treeRowPaths()).toEqual(["src/", "src/app.ts", "README.md"]);
  });

  test("keeps a closed parent closed and remembers its open child", async () => {
    const { client } = renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    await clickRow("src/");
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
        ...TREE,
        entries: [...TREE.entries, entry("file", "src/lib/added.ts")],
      });
    });
    await flushTree();
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);
    await clickRow("src/");
    expect(treeRowPaths()).toContain("src/lib/util.ts");
    expect(treeRowPaths()).toContain("src/lib/added.ts");
  });

  test("restores the user's open folders after paths change during a search", async () => {
    const { client } = renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    fireEvent.change(searchField(), { target: { value: "README" } });
    await flushTree();
    expect(treeRowPaths()).toEqual(["README.md"]);

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions(ROOT_PATH, null).queryKey, {
        ...TREE,
        entries: [...TREE.entries, entry("file", "src/lib/added.ts")],
      });
    });
    await flushTree();
    expect(treeRowPaths()).toEqual(["README.md"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await flushTree();
    expect(treeRowPaths()).toContain("src/lib/util.ts");
    expect(treeRowPaths()).toContain("src/lib/added.ts");
  });

  test("starts closed with no search when switching to another workspace", async () => {
    const { client, setRootPath } = renderPanel();
    await flushTree();
    await clickRow("src/");
    await clickRow("src/lib/");
    fireEvent.change(searchField(), { target: { value: "util" } });
    await flushTree();

    await act(async () => {
      client.setQueryData(workspaceFileTreeQueryOptions("/other-repo", null).queryKey, {
        ...TREE,
        rootPath: "/other-repo",
      });
      setRootPath("/other-repo");
    });
    await flushTree();
    expect(searchField()).toHaveProperty("value", "");
    expect(treeRowPaths()).toEqual(["src/", "README.md"]);
  });

  test.each(["util", "added"])(
    "updates an open search for %s after file paths change",
    async (query) => {
      const { client } = renderPanel();
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
