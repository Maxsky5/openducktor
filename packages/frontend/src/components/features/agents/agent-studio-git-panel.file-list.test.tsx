import { describe, expect, mock, test } from "bun:test";
import { fireEvent, type RenderResult, screen } from "@testing-library/react";
import { act, createElement, Fragment } from "react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { AgentStudioGitPanel, type AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import { FILE_LIST_VIEW_MODE_STORAGE_KEY } from "./agent-studio-git-panel/file-list-view-preference";
import {
  baseModel,
  ensureRenderer,
  flush,
  render,
  renderAgentStudioGitPanelElement,
  setupAgentStudioGitPanelTests,
  toFileDiff,
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
    const setDiffScope = mock((_scope: "target" | "uncommitted") => {});
    const fileStatuses = [
      { path: "src/a.ts", staged: false, status: "modified" },
      { path: "src/b.ts", staged: false, status: "modified" },
    ];
    const modelFor = (
      overrides: Partial<AgentStudioGitPanelModel>,
      targetFiles = ["src/a.ts", "docs/b.md"],
    ) =>
      baseModel({
        diffScope: "uncommitted",
        setDiffScope,
        fileStatuses,
        uncommittedFileCount: 2,
        scopeStatesByScope: {
          uncommitted: toScopeState({
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
    const fileCount = () => screen.getByTestId("agent-studio-git-file-count").textContent;

    await act(async () => {
      fireEvent.change(searchField(), { target: { value: "b.ts" } });
      await flush();
    });
    expect(fileCount()).toBe("1 of 2 changed files");
    expect(screen.getByText("2 files")).toBeDefined();

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), { button: 0 });
      await flush();
    });
    expect(setDiffScope).toHaveBeenCalledWith("target");
    expect(searchField()).toHaveProperty("value", "b.ts");
    expect(fileCount()).toBe("0 of 2 changed files");

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
    expect(fileCount()).toBe("2 changed files");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });
});
