import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileDiffList } from "./file-diff-list";
import {
  installMeasuredRows,
  OWNER_KEY,
  preloaderMock,
  setupFileDiffListTests,
} from "./file-diff-list.test-support";
import type { FileListViewMode } from "./file-list-view-preference";
import { useFileListState } from "./use-file-list-state";

setupFileDiffListTests();

const toFileDiff = (file: string, index = 0) => ({
  file,
  type: "modified" as const,
  additions: index + 1,
  deletions: 1,
  diff: `@@ -1 +1 @@\n-old\n+new ${file}\n`,
});

const TREE_FILES = ["src/lib/a.ts", "src/main.ts", "README.md"];

const ignoreDiffStyle = (): void => {};

function NavigableFileDiffListHarness({
  files = TREE_FILES,
  initialViewMode = "tree",
  initialExpandedFiles = [],
  preloadLimit = 0,
}: {
  files?: readonly string[];
  initialViewMode?: FileListViewMode;
  initialExpandedFiles?: readonly string[];
  preloadLimit?: number;
}): ReactElement {
  const fileDiffs = useMemo(() => files.map(toFileDiff), [files]);
  const [viewMode, setViewMode] = useState<FileListViewMode>(initialViewMode);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(initialExpandedFiles),
  );
  const [conflictedFiles] = useState<Set<string>>(new Set());
  // Stable callbacks, as in the app, so the memo of the file rows decides each row render.
  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);
  const listState = useFileListState({
    subjectKey: "task-1",
    diffScope: "uncommitted",
    fileDiffs,
  });

  return (
    <TooltipProvider>
      <div className="h-[400px]">
        <FileDiffList
          fileDiffs={fileDiffs}
          diffScope="uncommitted"
          ownerKey={OWNER_KEY}
          conflictedFiles={conflictedFiles}
          diffStyle="unified"
          setDiffStyle={ignoreDiffStyle}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          listState={listState}
          expandedFiles={expandedFiles}
          onToggleFile={toggleFile}
          preloadLimit={preloadLimit}
          canResetFiles={false}
          isResetDisabled={false}
          resetDisabledReason={null}
        />
      </div>
    </TooltipProvider>
  );
}

const numberedFiles = (directory: string, count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `${directory}/file-${String(index).padStart(2, "0")}.ts`,
  );
const PACKAGE_FILES = Array.from(
  { length: 100 },
  (_, index) => `pkg-${String(Math.floor(index / 5)).padStart(2, "0")}/f-${index % 5}.ts`,
);
const THREE_DIRECTORY_FILES = ["a", "b", "c"].flatMap((directory) => numberedFiles(directory, 30));

const directoryButton = (name: string): HTMLElement => screen.getByRole("button", { name });
const fileToggle = (file: string): HTMLElement =>
  screen.getByRole("button", { name: `Toggle diff for ${file}` });
const searchField = (): HTMLElement => screen.getByRole("textbox", { name: "Search files" });
const typeSearch = (value: string): void => {
  fireEvent.change(searchField(), { target: { value } });
};
const fileCountText = (): string =>
  screen.getByTestId("agent-studio-git-file-count").textContent ?? "";
const lineTotalsText = (): string =>
  screen.getByTestId("agent-studio-git-line-totals").textContent ?? "";
const rowTop = (rowButton: HTMLElement): number =>
  rowButton.closest('[role="listitem"]')!.getBoundingClientRect().top;
const highlightedTexts = (element: HTMLElement): string[] =>
  Array.from(element.querySelectorAll("mark"), (mark) => mark.textContent ?? "");
/** The files whose preload started, in mount order. */
const preloadedFiles = (): string[] => preloaderMock.mock.calls.map(([props]) => props.filePath);

describe("FileDiffList tree view and search", () => {
  test("groups files by directory with indented rows that keep their diff information", () => {
    render(<NavigableFileDiffListHarness />);

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual(["src", "lib", "a.ts+1-1", "main.ts+2-1", "README.md+3-1"]);
    expect(directoryButton("src").getAttribute("aria-expanded")).toBe("true");
    expect(directoryButton("src/lib").style.paddingLeft).toBe("1.75rem");
    expect(directoryButton("src/lib").getAttribute("title")).toBe("lib");

    const nestedFile = fileToggle("src/lib/a.ts");
    expect(nestedFile.style.paddingLeft).toBe("2.75rem");
    const label = within(nestedFile).getByTestId("agent-studio-git-file-path");
    expect(label.textContent).toBe("a.ts");
    expect(label.getAttribute("title")).toBe("src/lib/a.ts");
    expect(label.querySelector("[title]")).toBeNull();
    expect(within(nestedFile).getByTestId("agent-studio-git-file-stats").textContent).toBe("+1-1");
  });

  test("hides the files of a closed directory and keeps their expanded state", () => {
    render(<NavigableFileDiffListHarness />);
    fireEvent.click(fileToggle("src/lib/a.ts"));
    expect(screen.getByTestId("pierre-diff-viewer").textContent).toBe("src/lib/a.ts");

    fireEvent.click(directoryButton("src/lib"));
    expect(directoryButton("src/lib").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Toggle diff for src/lib/a.ts" })).toBeNull();

    fireEvent.click(directoryButton("src/lib"));
    expect(fileToggle("src/lib/a.ts").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("pierre-diff-viewer").textContent).toBe("src/lib/a.ts");
  });

  test("filters the files in both views, highlights matches, and counts only the matches", () => {
    render(<NavigableFileDiffListHarness />);
    expect(fileCountText()).toBe("3 changed files");
    expect(lineTotalsText()).toBe("+6-3");

    typeSearch("src main");
    expect(fileCountText()).toBe("1 of 3 changed files");
    expect(lineTotalsText()).toBe("+2-1");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "src",
      "main.ts+2-1",
    ]);
    expect(highlightedTexts(directoryButton("src"))).toEqual(["src"]);
    expect(highlightedTexts(fileToggle("src/main.ts"))).toEqual(["main"]);

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(searchField()).toHaveProperty("value", "src main");
    expect(fileCountText()).toBe("1 of 3 changed files");
    const listRow = fileToggle("src/main.ts");
    expect(within(listRow).getByTestId("agent-studio-git-file-path").textContent).toBe(
      "main.tssrc",
    );
    expect(highlightedTexts(listRow)).toEqual(["main", "src"]);
  });

  test("shows a message and keeps the controls when no file matches", () => {
    render(<NavigableFileDiffListHarness />);

    typeSearch("zzz");

    expect(screen.getByTestId("agent-studio-git-no-file-matches").textContent).toBe(
      'No files match "zzz"',
    );
    expect(fileCountText()).toBe("0 of 3 changed files");
    expect(lineTotalsText()).toBe("");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "Tree view" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Side-by-side" })).toBeDefined();

    typeSearch("readme");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "README.md+3-1",
    ]);
  });

  test("clears the search with the clear button and with Escape", () => {
    render(<NavigableFileDiffListHarness />);
    typeSearch("main");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(searchField()).toHaveProperty("value", "");
    expect(document.activeElement).toBe(searchField());
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(fileCountText()).toBe("3 changed files");

    const documentKeyDown = mock((_event: KeyboardEvent) => {});
    document.addEventListener("keydown", documentKeyDown);
    try {
      typeSearch("main");
      expect(fireEvent.keyDown(searchField(), { key: "Escape" })).toBe(false);
      expect(searchField()).toHaveProperty("value", "");
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      expect(documentKeyDown).not.toHaveBeenCalled();

      fireEvent.keyDown(searchField(), { key: "Escape" });
      expect(documentKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", documentKeyDown);
    }
  });

  test("updates the highlights of a shown row when the search is refined", () => {
    render(<NavigableFileDiffListHarness />);

    typeSearch("ma");
    expect(highlightedTexts(fileToggle("src/main.ts"))).toEqual(["ma"]);
    typeSearch("main");
    expect(highlightedTexts(fileToggle("src/main.ts"))).toEqual(["main"]);
  });

  test("updates the indent of a shown row when a search joins its directories", () => {
    render(<NavigableFileDiffListHarness />);
    expect(fileToggle("src/lib/a.ts").style.paddingLeft).toBe("2.75rem");

    // Only "src/lib/a.ts" matches, so "src" and "lib" join into one row.
    typeSearch("lib");

    expect(directoryButton("src/lib").textContent).toBe("src/lib");
    expect(fileToggle("src/lib/a.ts").style.paddingLeft).toBe("1.75rem");
  });

  test("switches view at once and keeps expanded files and open comment forms", () => {
    render(<NavigableFileDiffListHarness />);
    const treeButton = screen.getByRole("button", { name: "Tree view" });
    const listButton = screen.getByRole("button", { name: "List view" });
    expect(treeButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(fileToggle("src/main.ts"));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Keep this draft" },
    });

    fireEvent.click(listButton);

    expect(listButton.getAttribute("aria-pressed")).toBe("true");
    expect(treeButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("agent-studio-git-directory-toggle-button")).toBeNull();
    expect(fileToggle("src/main.ts").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByDisplayValue("Keep this draft")).toBeDefined();

    fireEvent.click(treeButton);
    expect(screen.getByDisplayValue("Keep this draft")).toBeDefined();
  });

  test("preloads the files that the list shows, in their order", () => {
    render(<NavigableFileDiffListHarness files={["z.ts", "src/a.ts"]} preloadLimit={1} />);
    // The tree lists directories before files.
    expect(preloadedFiles()).toEqual(["src/a.ts"]);

    typeSearch("z");
    expect(preloadedFiles()).toEqual(["src/a.ts", "z.ts"]);
  });

  describe("with measured rows", () => {
    let measurements: ReturnType<typeof installMeasuredRows>;

    beforeEach(() => {
      measurements = installMeasuredRows();
    });

    afterEach(() => {
      measurements.restore();
    });

    test("keeps the top visible file and known row heights when the view changes", () => {
      const files = Array.from(
        { length: 100 },
        (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
      );
      render(
        <NavigableFileDiffListHarness
          files={files}
          initialViewMode="list"
          initialExpandedFiles={["src/file-005.ts"]}
        />,
      );
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      const fileTop = (file: string): number =>
        fileToggle(file).closest('[role="listitem"]')!.getBoundingClientRect().top;
      fireEvent.scroll(list, { target: { scrollTop: 1_960 } });
      expect(fileTop("src/file-030.ts")).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);
      expect(fileTop("src/file-030.ts")).toBe(0);
      // The tree adds the 40px "src" row above the files.
      expect(list.scrollTop).toBe(2_000);

      fireEvent.scroll(list, { target: { scrollTop: 1_000 } });
      expect(fileTop("src/file-005.ts")).toBe(-760);

      fireEvent.scroll(list, { target: { scrollTop: 2_000 } });
      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      fireEvent.scroll(list);
      expect(fileTop("src/file-030.ts")).toBe(0);
    });

    test("finishes the scroll restore after a view switch, so a later expand does not jump", () => {
      render(<NavigableFileDiffListHarness files={PACKAGE_FILES} />);
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // Measure the files that list view shows near the anchor. Then no new row height runs the
      // restore again after the switch, and the restore must finish when those rows render.
      fireEvent.scroll(list, { target: { scrollTop: 86 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 100 * 40 } });
      // Each package has a directory row and 5 files, so "pkg-15/f-0.ts" is row 91.
      fireEvent.scroll(list, { target: { scrollTop: 91 * 40 + 20 } });
      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(-20);

      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      fireEvent.scroll(list);
      expect(list.scrollTop).toBe(75 * 40 + 20);
      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(-20);

      fireEvent.scroll(list, { target: { scrollTop: 400 } });
      fireEvent.click(fileToggle("pkg-02/f-1.ts"));

      expect(list.scrollTop).toBe(400);
      expect(rowTop(fileToggle("pkg-02/f-1.ts"))).toBe(40);
    });

    test("keeps the top file when resize reports still wait at a view switch", () => {
      const files = [
        "README.md",
        ...Array.from({ length: 100 }, (_, index) => `src/f-${String(index).padStart(3, "0")}.ts`),
      ];
      render(
        <NavigableFileDiffListHarness
          files={files}
          initialViewMode="list"
          initialExpandedFiles={["README.md"]}
        />,
      );
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // The expanded README.md is 800px tall, so "src/f-030.ts" starts at 2000px.
      fireEvent.scroll(list, { target: { scrollTop: 2_000 } });
      expect(rowTop(fileToggle("src/f-030.ts"))).toBe(0);
      // As in a browser, the rows report their sizes again before the next click.
      measurements.resize(600, 800, 1);

      // The tree puts README.md last, below the files of "src".
      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);

      expect(rowTop(fileToggle("src/f-030.ts"))).toBe(0);
    });

    test("drops the scroll restore when the user scrolls before the row renders", () => {
      render(<NavigableFileDiffListHarness files={PACKAGE_FILES} />);
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // Measure the files that list view shows at this scroll position. Then no new row height
      // renders the rows at the restore estimate before the user scrolls.
      fireEvent.scroll(list, { target: { scrollTop: 109 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 120 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 91 * 40 } });

      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      fireEvent.scroll(list, { target: { scrollTop: 400 } });
      expect(list.scrollTop).toBe(400);
      fireEvent.scroll(list, { target: { scrollTop: 2_900 } });

      expect(list.scrollTop).toBe(2_900);
    });

    test("keeps the known height of a file that a closed directory or a search hides", () => {
      render(
        <NavigableFileDiffListHarness
          files={THREE_DIRECTORY_FILES}
          initialExpandedFiles={["b/file-29.ts"]}
        />,
      );
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // Rows: "a", 30 files, "b", 29 files, the expanded "b/file-29.ts" at 61 x 40px, then "c".
      const scrollToDirectoryC = (): void => {
        fireEvent.scroll(list, { target: { scrollTop: 61 * 40 + 800 } });
      };
      fireEvent.scroll(list, { target: { scrollTop: 61 * 40 } });
      scrollToDirectoryC();
      expect(rowTop(directoryButton("c"))).toBe(0);

      fireEvent.scroll(list, { target: { scrollTop: 31 * 40 } });
      fireEvent.click(directoryButton("b"));
      fireEvent.click(directoryButton("b"));
      scrollToDirectoryC();
      expect(rowTop(directoryButton("c"))).toBe(0);

      typeSearch("c/");
      typeSearch("");
      scrollToDirectoryC();
      expect(rowTop(directoryButton("c"))).toBe(0);
    });

    test.each(["open", "closed"])(
      "shows the first file of the top %s directory when the tree changes to a list",
      (state) => {
        render(<NavigableFileDiffListHarness files={THREE_DIRECTORY_FILES} />);
        measurements.resize(600, 800);
        const list = screen.getByRole("list");
        // Rows: "a", 30 files, then "b" at 31 x 40px.
        fireEvent.scroll(list, { target: { scrollTop: 1_240 } });
        if (state === "closed") fireEvent.click(directoryButton("b"));
        expect(rowTop(directoryButton("b"))).toBe(0);

        fireEvent.click(screen.getByRole("button", { name: "List view" }));
        fireEvent.scroll(list);

        expect(rowTop(fileToggle("b/file-00.ts"))).toBe(0);
      },
    );

    test("shows the closed directory of the top file when the list changes to a tree", () => {
      render(<NavigableFileDiffListHarness files={THREE_DIRECTORY_FILES} />);
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      fireEvent.scroll(list, { target: { scrollTop: 1_240 } });
      fireEvent.click(directoryButton("b"));
      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      // List rows: 30 "a" files, then "b/file-05.ts" at 35 x 40px.
      fireEvent.scroll(list, { target: { scrollTop: 1_400 } });
      expect(rowTop(fileToggle("b/file-05.ts"))).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);

      expect(rowTop(directoryButton("b"))).toBe(0);
    });

    test("starts at the top when the rows show again after no file matched", () => {
      const { rerender } = render(<NavigableFileDiffListHarness files={PACKAGE_FILES} />);
      measurements.resize(600, 800);
      typeSearch("pkg");
      fireEvent.scroll(screen.getByRole("list"), { target: { scrollTop: 91 * 40 } });
      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(0);

      // A refresh removes every match, and a later refresh brings the files back.
      rerender(<NavigableFileDiffListHarness files={["README.md"]} />);
      expect(screen.queryByRole("list")).toBeNull();
      rerender(<NavigableFileDiffListHarness files={PACKAGE_FILES} />);
      const list = screen.getByRole("list");
      fireEvent.scroll(list, { target: { scrollTop: 80 } });

      expect(list.scrollTop).toBe(80);
    });

    test("keeps the top file through two view switches before the list settles", () => {
      render(<NavigableFileDiffListHarness files={PACKAGE_FILES} />);
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // Measure the files that list view shows at this scroll position, so the restore stays pending.
      fireEvent.scroll(list, { target: { scrollTop: 109 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 120 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 91 * 40 } });

      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);

      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(0);
    });

    test("shows the next file when a refresh removes the top file and files above it", () => {
      const files = Array.from(
        { length: 100 },
        (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
      );
      const { rerender } = render(
        <NavigableFileDiffListHarness files={files} initialViewMode="list" />,
      );
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      fireEvent.scroll(list, { target: { scrollTop: 30 * 40 } });
      expect(rowTop(fileToggle("src/file-030.ts"))).toBe(0);

      const remainingFiles = files.filter((_, index) => index >= 5 && index !== 30);
      rerender(<NavigableFileDiffListHarness files={remainingFiles} initialViewMode="list" />);
      fireEvent.scroll(list);

      expect(rowTop(fileToggle("src/file-031.ts"))).toBe(0);
    });
  });

  test("estimates the rows that are not measured as tall as a measured closed row", () => {
    // Rows are 41px tall, as in the app: the 40px row button and a 1px border.
    const measurements = installMeasuredRows({ closedRowHeight: 41 });
    try {
      render(<NavigableFileDiffListHarness files={PACKAGE_FILES} initialViewMode="list" />);
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      fireEvent.scroll(list, { target: { scrollTop: 3_000 } });
      fireEvent.scroll(list, {
        target: { scrollTop: list.scrollTop + rowTop(fileToggle("pkg-15/f-0.ts")) },
      });
      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(0);

      // The tree adds directory rows that were never measured, such as "pkg-15" right above the file.
      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);
      fireEvent.scroll(list);

      expect(rowTop(fileToggle("pkg-15/f-0.ts"))).toBe(0);
    } finally {
      measurements.restore();
    }
  });

  test("estimates the scroll again when the list is too short for the first estimate", () => {
    const measurements = installMeasuredRows({ clampScroll: true });
    try {
      const files = Array.from({ length: 210 }, (_, index) => {
        const directory = `d-${String(index).padStart(3, "0")}`;
        return [`${directory}/f-0.ts`, `${directory}/f-1.ts`];
      }).flat();
      render(
        <NavigableFileDiffListHarness
          files={files}
          initialViewMode="list"
          initialExpandedFiles={["d-166/f-0.ts", "d-166/f-1.ts", "d-167/f-0.ts"]}
        />,
      );
      measurements.resize(600, 800);
      const list = screen.getByRole("list");
      // Measure the three expanded files, which are far above "d-195/f-0.ts" (row 390).
      fireEvent.scroll(list, { target: { scrollTop: 332 * 40 } });
      fireEvent.scroll(list, { target: { scrollTop: 390 * 40 + 3 * 760 } });
      expect(rowTop(fileToggle("d-195/f-0.ts"))).toBe(0);

      // The tree adds a row for each directory. react-window sizes the list from the rows it has
      // measured, so the list is too short for the first estimate and the browser cuts it short.
      fireEvent.click(screen.getByRole("button", { name: "Tree view" }));
      fireEvent.scroll(list);
      fireEvent.scroll(list);

      expect(rowTop(fileToggle("d-195/f-0.ts"))).toBe(0);
    } finally {
      measurements.restore();
    }
  });

  test("shows the first match at the top when the search text changes", () => {
    const files = Array.from({ length: 100 }, (_, index) => `src/file-${index}.ts`);
    render(<NavigableFileDiffListHarness files={files} />);
    const list = screen.getByRole("list");
    fireEvent.scroll(list, { target: { scrollTop: 2_000 } });

    typeSearch("file-9");
    expect(list.scrollTop).toBe(0);
    fireEvent.scroll(list);

    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("src");
    expect(fileToggle("src/file-9.ts")).toBeDefined();
  });

  test("mounts a bounded row range for a large tree", () => {
    const files = Array.from(
      { length: 1_200 },
      (_, index) => `packages/package-${index % 40}/src/file-${index}.ts`,
    );
    render(<NavigableFileDiffListHarness files={files} />);

    expect(fileCountText()).toBe("1200 changed files");
    expect(screen.getAllByRole("listitem").length).toBeLessThan(40);

    typeSearch("package-7/src/file-1167");
    expect(fileCountText()).toBe("1 of 1200 changed files");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "packages/package-7/src",
      "file-1167.ts+1168-1",
    ]);
  });
});
