import { describe, expect, mock, test } from "bun:test";
import { fireEvent, type RenderResult, screen, within } from "@testing-library/react";
import { act, createElement, Fragment } from "react";
import { type GitChangeIntent, gitChangeIntentKey } from "@/features/agent-studio-git";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { AgentStudioGitPanel } from "./agent-studio-git-panel";
import { FILE_LIST_VIEW_MODE_STORAGE_KEY } from "./agent-studio-git-panel/file-list-view-preference";
import {
  baseModel,
  ensureRenderer,
  flush,
  type PanelModelInput,
  render,
  renderAgentStudioGitPanelElement,
  setupAgentStudioGitPanelTests,
  toFileDiff,
  toLocalChanges,
  toScopeState,
} from "./agent-studio-git-panel.test-support";

enableReactActEnvironment();

describe("AgentStudioGitPanel file list", () => {
  setupAgentStudioGitPanelTests();

  test("opens in tree view and shares the remembered view between panels", async () => {
    const fileDiffs = [toFileDiff("src/a.ts"), toFileDiff("README.md")];
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(
          Fragment,
          null,
          createElement(AgentStudioGitPanel, { model: baseModel({ fileDiffs }) }),
          createElement(AgentStudioGitPanel, {
            model: baseModel({ subjectKey: "task-12", fileDiffs }),
          }),
        ),
      );
      await flush();
    });
    const pressedViews = (name: string): Array<string | null> =>
      screen.getAllByRole("button", { name }).map((button) => button.getAttribute("aria-pressed"));
    expect(pressedViews("Tree view")).toEqual(["true", "true"]);
    expect(screen.getAllByRole("button", { name: "src" })).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "List view" })[0]!);
      await flush();
    });

    expect(pressedViews("List view")).toEqual(["true", "true"]);
    expect(screen.queryByRole("button", { name: "src" })).toBeNull();
    expect(globalThis.localStorage.getItem(FILE_LIST_VIEW_MODE_STORAGE_KEY)).toBe("list");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("keeps the search text across scope switches and clears it for another task", async () => {
    const fileStatuses = [
      { path: "src/a.ts", staged: false, status: "modified" },
      { path: "src/b.ts", staged: false, status: "modified" },
    ];
    const modelFor = (overrides: PanelModelInput, targetFiles = ["src/a.ts", "docs/b.md"]) =>
      baseModel({
        diffScope: "uncommitted",
        fileStatuses,
        uncommittedFileCount: 2,
        scopeStatesByScope: {
          uncommitted: toScopeState({
            localChanges: toLocalChanges({
              unstaged: ["src/a.ts", "src/b.ts"],
            }),
            fileDiffs: [toFileDiff("src/a.ts"), toFileDiff("src/b.ts")],
            fileStatuses,
            uncommittedFileCount: 2,
          }),
          target: toScopeState({
            fileDiffs: targetFiles.map(toFileDiff),
            fileStatuses,
            uncommittedFileCount: 2,
          }),
        },
        ...overrides,
      });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: modelFor({}) }));
      await flush();
    });
    const searchField = () => screen.getByRole("textbox", { name: "Search files" });
    const fileCount = () =>
      screen.queryByTestId("agent-studio-git-file-count")?.textContent ?? null;

    await act(async () => {
      fireEvent.change(searchField(), { target: { value: "b.ts" } });
      await flush();
    });
    expect(fileCount()).toBe("1/2");
    const uncommittedBadge = within(
      screen.getByTestId("agent-studio-git-diff-scope-uncommitted"),
    ).getByLabelText("2 files");
    expect(uncommittedBadge.textContent).toBe("2");

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), { button: 0 });
      await flush();
    });
    expect(
      screen.getByTestId("agent-studio-git-diff-scope-target").getAttribute("aria-selected"),
    ).toBe("true");
    expect(searchField()).toHaveProperty("value", "b.ts");
    expect(fileCount()).toBe("0/2");

    // A scope with no files shows the empty state without the file list.
    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(modelFor({ diffScope: "target" }, [])),
      );
      await flush();
    });
    expect(screen.queryByRole("textbox", { name: "Search files" })).toBeNull();
    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(modelFor({ diffScope: "target" })),
      );
      await flush();
    });
    expect(searchField()).toHaveProperty("value", "b.ts");

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(modelFor({ diffScope: "target", subjectKey: "task-12" })),
      );
      await flush();
    });
    expect(searchField()).toHaveProperty("value", "");
    expect(fileCount()).toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders unstaged and staged groups with their files and counts", async () => {
    const modelFor = (stagedPaths: string[]) =>
      baseModel({
        diffScope: "uncommitted",
        fileStatuses: [
          { path: "src/a.ts", staged: false, status: "modified" },
          { path: "src/b.ts", staged: false, status: "modified" },
          ...stagedPaths.map((path) => ({ path, staged: true, status: "modified" })),
        ],
        fileDiffs: ["src/a.ts", "src/b.ts", ...stagedPaths].map(toFileDiff),
      });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: modelFor(["src/c.ts"]) }));
      await flush();
    });

    const unstaged = screen.getByTestId("agent-studio-git-group-unstaged");
    const staged = screen.getByTestId("agent-studio-git-group-staged");
    expect(screen.queryByTestId("agent-studio-git-group-conflicted")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-unstaged-count").textContent).toBe("2");
    expect(screen.getByTestId("agent-studio-git-staged-count").textContent).toBe("1");
    expect(
      within(unstaged)
        .getAllByTestId("agent-studio-git-file-toggle-button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Toggle diff for src/a.ts", "Toggle diff for src/b.ts"]);
    expect(
      within(staged)
        .getAllByTestId("agent-studio-git-file-toggle-button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Toggle diff for src/c.ts"]);
    expect(within(unstaged).getAllByTestId("agent-studio-git-stage-file-button")).toHaveLength(2);
    expect(within(staged).getAllByTestId("agent-studio-git-unstage-file-button")).toHaveLength(1);

    // The test DOM has no hit testing. The toggle layer covers the header, and the group action
    // sits above it, so a click anywhere else on the header toggles the group in a browser.
    const groupToggle = within(unstaged).getByRole("button", { name: /^Unstaged/, expanded: true });
    expect(groupToggle.className).toContain("after:absolute after:inset-0");
    expect(groupToggle.closest("h3")?.parentElement?.className).toContain("relative");
    expect(within(unstaged).getByTestId("agent-studio-git-stage-all-button").className).toContain(
      "relative z-10",
    );
    await act(async () => {
      fireEvent.click(groupToggle);
      await flush();
    });
    expect(within(unstaged).queryByTestId("agent-studio-git-file-toggle-button")).toBeNull();
    expect(
      within(unstaged).getByRole("button", { name: /^Unstaged/, expanded: false }),
    ).toBeDefined();

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(modelFor([])));
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-staged-count").textContent).toBe("0");
    expect(screen.getByTestId("agent-studio-git-staged-empty").textContent).toBe(
      "No staged changes",
    );
    expect(screen.queryByTestId("agent-studio-git-unstage-all-button")).toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows a Stage or Unstage request at once and keeps the Git snapshots", async () => {
    const modelFor = (pendingChanges: GitChangeIntent[]) =>
      baseModel({
        diffScope: "uncommitted",
        fileStatuses: [
          { path: "src/a.ts", staged: false, status: "modified" },
          { path: "src/b.ts", staged: false, status: "modified" },
          { path: "src/c.ts", staged: true, status: "modified" },
        ],
        fileDiffs: ["src/a.ts", "src/b.ts", "src/c.ts"].map(toFileDiff),
        pendingChanges,
      });
    const rows = (group: "unstaged" | "staged") =>
      within(screen.getByTestId(`agent-studio-git-group-${group}`))
        .queryAllByTestId("agent-studio-git-file-toggle-button")
        .map((button) => button.getAttribute("aria-label"));
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: modelFor([
            {
              action: "stage",
              group: "unstaged",
              selection: { kind: "file", filePath: "src/a.ts" },
            },
          ]),
        }),
      );
      await flush();
    });

    expect(rows("unstaged")).toEqual(["Toggle diff for src/b.ts"]);
    expect(rows("staged")).toEqual(["Toggle diff for src/a.ts", "Toggle diff for src/c.ts"]);
    expect(screen.getByTestId("agent-studio-git-staged-count").textContent).toBe("2");

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          modelFor([{ action: "unstage", group: "staged", selection: { kind: "all" } }]),
        ),
      );
      await flush();
    });
    expect(rows("staged")).toEqual([]);
    expect(rows("unstaged")).toEqual([
      "Toggle diff for src/a.ts",
      "Toggle diff for src/b.ts",
      "Toggle diff for src/c.ts",
    ]);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("splits the height between unstaged and staged and lets the user move the split", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileStatuses: [
              { path: "src/a.ts", staged: false, status: "modified" },
              { path: "src/c.ts", staged: true, status: "modified" },
            ],
            fileDiffs: ["src/a.ts", "src/c.ts"].map(toFileDiff),
          }),
        }),
      );
      await flush();
    });
    const pane = (group: "unstaged" | "staged") =>
      screen.getByTestId(`agent-studio-git-group-${group}`).parentElement?.style.flex;
    const handle = () =>
      screen.getByRole("separator", { name: "Resize the staged and unstaged lists" });

    expect(handle().getAttribute("aria-valuenow")).toBe("50");
    expect([pane("unstaged"), pane("staged")]).toEqual(["0.5 1 0%", "0.5 1 0%"]);

    await act(async () => {
      fireEvent.keyDown(handle(), { key: "ArrowDown" });
      await flush();
    });
    expect(handle().getAttribute("aria-valuenow")).toBe("55");
    for (let step = 0; step < 20; step += 1) {
      fireEvent.keyDown(handle(), { key: "ArrowUp" });
    }
    await act(flush);
    expect(handle().getAttribute("aria-valuenow")).toBe("15");
    await act(async () => {
      fireEvent.doubleClick(handle());
      await flush();
    });
    expect(handle().getAttribute("aria-valuenow")).toBe("50");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Unstaged/, expanded: true }));
      await flush();
    });
    expect(screen.queryByRole("separator")).toBeNull();
    expect([pane("unstaged"), pane("staged")]).toEqual(["0 0 auto", "1 1 0%"]);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("Stage all and Unstage all send whole-group intents that include hidden files", async () => {
    const changeSelection = mock((_intent: GitChangeIntent) => {});
    const stageAll: GitChangeIntent = {
      action: "stage",
      group: "unstaged",
      selection: { kind: "all" },
    };
    const modelFor = (changingKey: string | null) =>
      baseModel({
        diffScope: "uncommitted",
        changeSelection,
        changingKey,
        fileStatuses: [
          { path: "src/a.ts", staged: false, status: "modified" },
          { path: "src/b.ts", staged: false, status: "modified" },
          { path: "src/c.ts", staged: true, status: "modified" },
        ],
        fileDiffs: ["src/a.ts", "src/b.ts", "src/c.ts"].map(toFileDiff),
      });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: modelFor(null) }));
      await flush();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Search files" }), {
        target: { value: "a.ts" },
      });
      await flush();
    });
    const stageAllButton = screen.getByTestId("agent-studio-git-stage-all-button");
    expect(stageAllButton.getAttribute("aria-label")).toBe(
      "Stage all: 2 unstaged files, including files that the search hides",
    );

    await act(async () => {
      fireEvent.click(stageAllButton);
      fireEvent.click(screen.getByTestId("agent-studio-git-unstage-all-button"));
      await flush();
    });
    expect(changeSelection.mock.calls).toEqual([
      [stageAll],
      [{ action: "unstage", group: "staged", selection: { kind: "all" } }],
    ]);

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(modelFor(gitChangeIntentKey(stageAll))),
      );
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-stage-all-button").innerHTML).toContain(
      "animate-spin",
    );
    expect(screen.getByTestId("agent-studio-git-unstage-all-button").innerHTML).not.toContain(
      "animate-spin",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });
});
