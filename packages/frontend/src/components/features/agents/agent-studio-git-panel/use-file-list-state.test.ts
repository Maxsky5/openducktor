import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import type { DiffScope } from "@/features/agent-studio-git";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { useFileListState } from "./use-file-list-state";

enableReactActEnvironment();

type StateProps = {
  subjectKey: string;
  diffScope: DiffScope;
  fileDiffs: readonly FileDiff[];
};

const fileDiffs = (...files: string[]): FileDiff[] =>
  files.map((file) => ({
    file,
    type: "modified",
    additions: 1,
    deletions: 1,
    diff: "@@ -1 +1 @@\n-old\n+new\n",
  }));

const renderListState = (initialProps: Partial<StateProps> = {}) => {
  const props: StateProps = {
    subjectKey: "task-1",
    diffScope: "uncommitted",
    fileDiffs: fileDiffs("src/lib/a.ts", "src/main.ts", "docs/guide.md"),
    ...initialProps,
  };
  const view = renderHook((hookProps: StateProps) => useFileListState(hookProps), {
    initialProps: props,
  });
  return {
    current: () => view.result.current,
    rerender: (nextProps: Partial<StateProps>) => {
      Object.assign(props, nextProps);
      act(() => view.rerender({ ...props }));
    },
    act: (run: (state: ReturnType<typeof useFileListState>) => void) => {
      act(() => run(view.result.current));
    },
  };
};

describe("useFileListState", () => {
  test("starts with every directory open and no search", () => {
    const listState = renderListState();

    expect(listState.current().searchText).toBe("");
    expect(listState.current().appliedSearchText).toBe("");
    expect(listState.current().closedDirectories.size).toBe(0);

    const state = listState.current();
    listState.rerender({});
    expect(listState.current()).toBe(state);
  });

  test("closes the innermost directory of a row and opens every directory of a closed row", () => {
    const listState = renderListState();

    listState.act((state) => state.toggleDirectory({ path: "a/b", chainPaths: ["a", "a/b"] }));
    expect([...listState.current().closedDirectories]).toEqual(["a/b"]);
    listState.act((state) => state.toggleDirectory({ path: "a/b", chainPaths: ["a", "a/b"] }));
    expect(listState.current().closedDirectories.size).toBe(0);

    // "a" was closed while it was its own row.
    listState.act((state) => state.toggleDirectory({ path: "a", chainPaths: ["a"] }));
    listState.act((state) => state.toggleDirectory({ path: "a/b", chainPaths: ["a", "a/b"] }));
    expect(listState.current().closedDirectories.size).toBe(0);
  });

  test("opens all directories during a search and restores the previous state after it", () => {
    const listState = renderListState();
    listState.act((state) => state.toggleDirectory({ path: "src/lib", chainPaths: ["src/lib"] }));

    listState.act((state) => state.setSearchText("T s"));
    expect(listState.current().appliedSearchText).toBe("T s");
    expect(listState.current().query).toBe("ts");
    expect(listState.current().closedDirectories.size).toBe(0);

    listState.act((state) => state.toggleDirectory({ path: "src", chainPaths: ["src"] }));
    expect([...listState.current().closedDirectories]).toEqual(["src"]);

    listState.act((state) => state.setSearchText("t"));
    expect(listState.current().closedDirectories.size).toBe(0);

    listState.act((state) => state.setSearchText(""));
    expect([...listState.current().closedDirectories]).toEqual(["src/lib"]);
  });

  test("keeps the search text and opens all directories when the diff scope changes", () => {
    const listState = renderListState();
    listState.act((state) => state.toggleDirectory({ path: "src/lib", chainPaths: ["src/lib"] }));
    listState.act((state) => state.setSearchText("main"));

    listState.rerender({ diffScope: "target" });

    expect(listState.current().searchText).toBe("main");
    listState.act((state) => state.setSearchText(""));
    expect(listState.current().closedDirectories.size).toBe(0);
  });

  test("clears the search text and opens all directories for a different task or session", () => {
    const listState = renderListState();
    listState.act((state) => state.toggleDirectory({ path: "src/lib", chainPaths: ["src/lib"] }));
    listState.act((state) => state.setSearchText("main"));

    listState.rerender({ subjectKey: "task-2" });

    expect(listState.current().searchText).toBe("");
    expect(listState.current().appliedSearchText).toBe("");
    expect(listState.current().closedDirectories.size).toBe(0);
  });

  test("opens a directory that comes back after it left the change set", () => {
    const listState = renderListState();
    listState.act((state) => state.toggleDirectory({ path: "src/lib", chainPaths: ["src/lib"] }));
    listState.act((state) => state.toggleDirectory({ path: "docs", chainPaths: ["docs"] }));

    listState.rerender({ fileDiffs: fileDiffs("src/main.ts", "docs/guide.md") });
    expect([...listState.current().closedDirectories]).toEqual(["docs"]);

    listState.rerender({ fileDiffs: fileDiffs("src/lib/a.ts", "docs/guide.md") });
    expect([...listState.current().closedDirectories]).toEqual(["docs"]);
  });
});
