import { describe, expect, mock, test } from "bun:test";
import type { GitFileDiff, GitChangeGroup } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, type ReactElement, useMemo, useState } from "react";
import {
  type DiffScope,
  type GitChangeIntent,
  gitChangeIntentKey,
} from "@/features/agent-studio-git";
import { toInlineCommentDraftStorageKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-storage";
import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { FILE_LIST_ROW_HEIGHT } from "./constants";
import { FileDiffListWithHeader } from "./file-diff-list";
import {
  COMMENTABLE_PATCH,
  fileDiffListDrafts,
  installMeasuredRows,
  OWNER_KEY,
  preloaderMock,
  setupFileDiffListTests,
  viewerMock,
} from "./file-diff-list.test-support";
import { FileDiffListProviders } from "./file-diff-list.test-providers";
import type { GitFileRowActions } from "./git-file-row-actions";
import type { FileListState } from "./use-file-list-state";

setupFileDiffListTests();

const OTHER_OWNER_KEY = toInlineCommentDraftStorageKey({
  workspaceId: "workspace-1",
  taskId: "task-2",
});

const IDLE_FILE_LIST_STATE: FileListState = {
  searchText: "",
  setSearchText: () => {},
  appliedSearchText: "",
  query: "",
  closedDirectories: new Set(),
  toggleDirectory: () => {},
};

const LIST_VIEW_PROPS = {
  viewMode: "list",
  onViewModeChange: () => {},
  listState: IDLE_FILE_LIST_STATE,
  listLabel: "Changed files",
  onViewFile: null,
  rowActions: null,
  changingKey: null,
} as const;

const commentableFileDiff = (file: string): GitFileDiff => ({
  file,
  type: "modified",
  additions: 2,
  deletions: 1,
  diff: COMMENTABLE_PATCH,
});

function createRowActions(
  group: GitChangeGroup,
  overrides: Partial<Omit<GitFileRowActions, "group" | "onChange">> = {},
) {
  const onChange = mock((_intent: GitChangeIntent) => {});
  const actions: GitFileRowActions = {
    group,
    disabledReason: null,
    onChange,
    ...overrides,
  };
  return { actions, onChange };
}

const fileIntent = (
  action: GitChangeIntent["action"],
  group: GitChangeGroup,
  filePath: string,
): GitChangeIntent => ({ action, group, selection: { kind: "file", filePath } });

const fileToggle = (file: string): HTMLElement =>
  screen.getByRole("button", { name: `Toggle diff for ${file}` });

/** Opens the row menu with its button, after an earlier menu closes. */
const openRowMenu = async (file: string) => {
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${file}` }));
  return within(await screen.findByTestId("agent-studio-git-file-menu"));
};

const addCommentOnSelectedLines = (text: string): void => {
  fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
  fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
};

function FileDiffListHarness({
  file = "src/example.ts",
  type = "modified",
  diff = COMMENTABLE_PATCH,
  ownerKey = OWNER_KEY,
  diffScope = "uncommitted",
  commentPlaceholder,
  commentsByFile,
  rowActions = null,
  onViewFile = null,
  changingKey = null,
}: {
  file?: string;
  type?: GitFileDiff["type"];
  diff?: string;
  ownerKey?: string;
  diffScope?: DiffScope;
  commentPlaceholder?: string;
  commentsByFile?: ReadonlyMap<string, InlineCommentDraft[]>;
  rowActions?: GitFileRowActions | null;
  onViewFile?: ((filePath: string) => void) | null;
  changingKey?: string | null;
} = {}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  return (
    <FileDiffListProviders>
      <FileDiffListWithHeader
        {...LIST_VIEW_PROPS}
        changingKey={changingKey}
        fileDiffs={[{ file, type, additions: 2, deletions: 1, diff }]}
        diffScope={diffScope}
        listKey={diffScope}
        ownerKey={ownerKey}
        commentPlaceholder={commentPlaceholder}
        commentsByFile={commentsByFile}
        conflictedFiles={new Set()}
        diffStyle="unified"
        setDiffStyle={() => {}}
        expandedFiles={expandedFiles}
        onToggleFile={(filePath) => {
          setExpandedFiles((previous) => {
            const next = new Set(previous);
            if (next.has(filePath)) {
              next.delete(filePath);
            } else {
              next.add(filePath);
            }
            return next;
          });
        }}
        onViewFile={onViewFile}
        preloadLimit={1}
        rowActions={rowActions}
      />
    </FileDiffListProviders>
  );
}

function ScopeSwitchFileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/example.ts"]));
  const [diffScope, setDiffScope] = useState<"uncommitted" | "target">("uncommitted");

  return (
    <FileDiffListProviders>
      <button
        type="button"
        onClick={() => {
          setDiffScope("target");
          setExpandedFiles(new Set());
        }}
      >
        Switch scope
      </button>
      <FileDiffListWithHeader
        {...LIST_VIEW_PROPS}
        fileDiffs={[commentableFileDiff("src/example.ts")]}
        diffScope={diffScope}
        listKey={diffScope}
        ownerKey={OWNER_KEY}
        conflictedFiles={new Set()}
        diffStyle="unified"
        setDiffStyle={() => {}}
        expandedFiles={expandedFiles}
        onToggleFile={(filePath) => {
          setExpandedFiles((previous) => {
            const next = new Set(previous);
            if (next.has(filePath)) {
              next.delete(filePath);
            } else {
              next.add(filePath);
            }
            return next;
          });
        }}
        preloadLimit={1}
      />
    </FileDiffListProviders>
  );
}

function OwnerSwitchFileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/example.ts"]));
  const [ownerKey, setOwnerKey] = useState(OWNER_KEY);

  return (
    <FileDiffListProviders>
      <button
        type="button"
        onClick={() =>
          setOwnerKey((current) => (current === OWNER_KEY ? OTHER_OWNER_KEY : OWNER_KEY))
        }
      >
        Switch owner
      </button>
      <FileDiffListWithHeader
        {...LIST_VIEW_PROPS}
        fileDiffs={[commentableFileDiff("src/example.ts")]}
        diffScope="uncommitted"
        listKey="uncommitted"
        ownerKey={ownerKey}
        conflictedFiles={new Set()}
        diffStyle="unified"
        setDiffStyle={() => {}}
        expandedFiles={expandedFiles}
        onToggleFile={(filePath) => {
          setExpandedFiles((previous) => {
            const next = new Set(previous);
            if (next.has(filePath)) {
              next.delete(filePath);
            } else {
              next.add(filePath);
            }
            return next;
          });
        }}
        preloadLimit={1}
      />
    </FileDiffListProviders>
  );
}

function LargeFileDiffListHarness(): ReactElement {
  const [fileCount, setFileCount] = useState(1_000);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/file-000.ts"]));
  const fileDiffs = useMemo(
    () =>
      Array.from({ length: fileCount }, (_, index) =>
        commentableFileDiff(`src/file-${String(index).padStart(3, "0")}.ts`),
      ),
    [fileCount],
  );

  return (
    <FileDiffListProviders>
      <button type="button" onClick={() => setFileCount(20)}>
        Shorten list
      </button>
      <div className="h-[400px]">
        <FileDiffListWithHeader
          {...LIST_VIEW_PROPS}
          fileDiffs={fileDiffs}
          diffScope="uncommitted"
          listKey="uncommitted"
          ownerKey={OWNER_KEY}
          conflictedFiles={new Set()}
          diffStyle="unified"
          setDiffStyle={() => {}}
          expandedFiles={expandedFiles}
          onToggleFile={(filePath) => {
            setExpandedFiles((previous) => {
              const next = new Set(previous);
              if (next.has(filePath)) next.delete(filePath);
              else next.add(filePath);
              return next;
            });
          }}
          preloadLimit={0}
        />
      </div>
    </FileDiffListProviders>
  );
}

function ResizingFileDiffListHarness({ fileCount = 20 } = {}): ReactElement {
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [revision, setRevision] = useState(0);
  const [taskChanged, setTaskChanged] = useState(false);
  const [ownerKey, setOwnerKey] = useState(OWNER_KEY);
  const [fileOrderChange, setFileOrderChange] = useState<"none" | "remove" | "move">("none");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/file-005.ts"]));
  const pathPrefix = taskChanged ? "other/" : "src/";
  const fileDiffs = useMemo(() => {
    const files = Array.from({ length: fileCount }, (_, index) => ({
      file: `${pathPrefix}file-${String(index).padStart(3, "0")}.ts`,
      type: "modified" as const,
      additions: 1,
      deletions: 1,
      diff: `@@ -1 +1 @@\n-old\n+new${index === 10 ? revision : ""}\n`,
    }));
    if (fileOrderChange === "remove") return files.filter((_, index) => index !== 5);
    if (fileOrderChange === "move") return [...files.slice(0, 5), ...files.slice(6), files[5]!];
    return files;
  }, [fileCount, fileOrderChange, pathPrefix, revision]);

  return (
    <FileDiffListProviders>
      <button type="button" onClick={() => setRevision((current) => current + 1)}>
        Refresh another file
      </button>
      <button type="button" onClick={() => setFileOrderChange("remove")}>
        Remove expanded file
      </button>
      <button type="button" onClick={() => setFileOrderChange("move")}>
        Move expanded file to end
      </button>
      <button type="button" onClick={() => setOwnerKey(OTHER_OWNER_KEY)}>
        Switch list owner
      </button>
      <button
        type="button"
        onClick={() => {
          setTaskChanged(true);
          setExpandedFiles(new Set(["other/file-005.ts"]));
        }}
      >
        Switch task files
      </button>
      <div className="h-[400px]">
        <FileDiffListWithHeader
          {...LIST_VIEW_PROPS}
          fileDiffs={fileDiffs}
          diffScope="uncommitted"
          listKey="uncommitted"
          ownerKey={ownerKey}
          conflictedFiles={new Set()}
          diffStyle={diffStyle}
          setDiffStyle={setDiffStyle}
          expandedFiles={expandedFiles}
          onToggleFile={(filePath) => {
            setExpandedFiles((previous) => {
              const next = new Set(previous);
              if (next.has(filePath)) next.delete(filePath);
              else next.add(filePath);
              return next;
            });
          }}
          preloadLimit={0}
        />
      </div>
    </FileDiffListProviders>
  );
}

describe("FileDiffList", () => {
  test.each(["Remove expanded file", "Move expanded file to end"])(
    "keeps the visible file and scroll direction after %s offscreen",
    (action) => {
      const measurements = installMeasuredRows();
      try {
        render(<ResizingFileDiffListHarness fileCount={100} />);
        measurements.resize(600, 800);
        const list = screen.getByRole("list");
        const fileTop = (file: string): number =>
          screen
            .getByRole("button", { name: `Toggle diff for src/${file}.ts` })
            .closest('[role="listitem"]')!
            .getBoundingClientRect().top;

        fireEvent.scroll(list, { target: { scrollTop: 1_960 } });
        expect(fileTop("file-030")).toBe(0);
        fireEvent.click(screen.getByRole("button", { name: action }));
        fireEvent.scroll(list);
        expect(fileTop("file-030")).toBe(0);
        expect(list.scrollTop).toBe(1_160);

        fireEvent.scroll(list, { target: { scrollTop: 1_120 } });
        expect(fileTop("file-029")).toBe(0);
        fireEvent.scroll(list, { target: { scrollTop: 1_080 } });
        expect(fileTop("file-028")).toBe(0);

        if (action === "Move expanded file to end") {
          fireEvent.scroll(list, { target: { scrollTop: 3_960 } });
          expect(fileTop("file-005")).toBe(0);
        }
      } finally {
        measurements.restore();
      }
    },
  );

  test("mounts a bounded row range and reaches the last file", () => {
    render(<LargeFileDiffListHarness />);
    const list = screen.getByRole("list");
    expect(screen.getAllByTestId("agent-studio-git-file-toggle-button").length).toBeLessThan(30);

    fireEvent.scroll(list, { target: { scrollTop: 39_600 } });
    expect(screen.getByRole("button", { name: "Toggle diff for src/file-999.ts" })).toBeDefined();
    expect(screen.getAllByTestId("agent-studio-git-file-toggle-button").length).toBeLessThan(30);
  });

  test("keeps unfinished comment text after a virtual row leaves the viewport", () => {
    render(<LargeFileDiffListHarness />);
    const list = screen.getByRole("list");
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Keep this draft" },
    });

    fireEvent.scroll(list, { target: { scrollTop: 39_600 } });
    expect(screen.queryByRole("button", { name: "Toggle diff for src/file-000.ts" })).toBeNull();
    fireEvent.scroll(list, { target: { scrollTop: 0 } });

    expect(screen.getByDisplayValue("Keep this draft")).toBeDefined();
  });

  test("keeps an unfinished comment edit after a virtual row leaves the viewport", () => {
    render(<LargeFileDiffListHarness />);
    const list = screen.getByRole("list");
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Saved comment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Saved comment"), {
      target: { value: "Unfinished edit" },
    });

    fireEvent.scroll(list, { target: { scrollTop: 39_600 } });
    fireEvent.scroll(list, { target: { scrollTop: 0 } });

    expect(screen.getByDisplayValue("Unfinished edit")).toBeDefined();
  });

  test("shows the remaining files when a list shrinks near the end", () => {
    render(<LargeFileDiffListHarness />);
    const list = screen.getByRole("list");
    fireEvent.scroll(list, { target: { scrollTop: 39_600 } });
    fireEvent.click(screen.getByRole("button", { name: "Shorten list" }));

    expect(screen.getByRole("button", { name: "Toggle diff for src/file-019.ts" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Toggle diff for src/file-999.ts" })).toBeNull();
  });

  test("keeps the reading offset when style and width change inside an expanded diff", () => {
    const measurements = installMeasuredRows();
    try {
      render(<ResizingFileDiffListHarness />);
      const list = screen.getByRole("list");
      Object.defineProperty(list, "scrollTo", {
        value: ({ top }: ScrollToOptions) => {
          list.scrollTop = top ?? 0;
        },
      });
      measurements.resize(600, 800);
      fireEvent.scroll(list, { target: { scrollTop: 500 } });

      fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));
      measurements.resize(600, 900);
      expect(list.scrollTop).toBe(500);

      measurements.resize(400, 1_000);
      expect(list.scrollTop).toBe(500);

      fireEvent.click(screen.getByRole("button", { name: "Refresh another file" }));
      measurements.resize(400, 1_000);
      expect(list.scrollTop).toBe(500);
    } finally {
      measurements.restore();
    }
  });

  test("moves later rows after an inline comment form changes an expanded row's height", () => {
    const measurements = installMeasuredRows();
    try {
      render(<ResizingFileDiffListHarness />);
      measurements.resize(600, 800);
      const nextFile = screen.getByRole("button", { name: "Toggle diff for src/file-006.ts" });
      expect(nextFile.closest('[role="listitem"]')?.getAttribute("style")).toContain("1000px");

      fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
      expect(screen.getByTestId("agent-studio-git-new-comment-form")).toBeDefined();
      measurements.resize(600, 1_000);
      expect(nextFile.closest('[role="listitem"]')?.getAttribute("style")).toContain("1200px");

      fireEvent.scroll(screen.getByRole("list"), { target: { scrollTop: 1_360 } });
      expect(screen.getByRole("button", { name: "Toggle diff for src/file-019.ts" })).toBeDefined();
    } finally {
      measurements.restore();
    }
  });

  test("keeps adjacent rows separate during a panel resize", () => {
    const measurements = installMeasuredRows();
    try {
      render(<ResizingFileDiffListHarness />);
      measurements.resize(600, 800);

      const expandedRow = screen
        .getByRole("button", { name: "Toggle diff for src/file-005.ts" })
        .closest('[role="listitem"]');
      const nextRow = screen
        .getByRole("button", { name: "Toggle diff for src/file-006.ts" })
        .closest('[role="listitem"]');
      expect(expandedRow).not.toBeNull();
      expect(nextRow).not.toBeNull();
      expect(nextRow!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        expandedRow!.getBoundingClientRect().bottom,
      );

      for (const { width, height } of [
        { width: 550, height: 850 },
        { width: 500, height: 875 },
        { width: 450, height: 900 },
        { width: 400, height: 950 },
      ]) {
        measurements.resize(width, height, 1);
        expect(nextRow!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          expandedRow!.getBoundingClientRect().bottom,
        );
      }

      measurements.resize(400, 1_000, 0);
      fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));
      expect(nextRow!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        expandedRow!.getBoundingClientRect().bottom,
      );
    } finally {
      measurements.restore();
    }
  });

  test("measures expanded rows before showing another task's file list", () => {
    const measurements = installMeasuredRows();
    try {
      render(<ResizingFileDiffListHarness />);
      measurements.resize(600, 800);

      measurements.resize(600, 1_000, 0);
      fireEvent.click(screen.getByRole("button", { name: "Switch task files" }));
      const expandedRow = screen
        .getByRole("button", { name: "Toggle diff for other/file-005.ts" })
        .closest('[role="listitem"]');
      const nextRow = screen
        .getByRole("button", { name: "Toggle diff for other/file-006.ts" })
        .closest('[role="listitem"]');
      expect(expandedRow).not.toBeNull();
      expect(nextRow).not.toBeNull();
      expect(nextRow!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        expandedRow!.getBoundingClientRect().bottom,
      );
    } finally {
      measurements.restore();
    }
  });

  test("remeasures unchanged rows before displaying another owner's diffs", () => {
    const measurements = installMeasuredRows();
    try {
      render(<ResizingFileDiffListHarness />);
      measurements.resize(600, 800);

      fireEvent.click(screen.getByRole("button", { name: "Switch list owner" }));
      const expandedRow = screen
        .getByRole("button", { name: "Toggle diff for src/file-005.ts" })
        .closest('[role="listitem"]')!;
      const nextRow = screen
        .getByRole("button", { name: "Toggle diff for src/file-006.ts" })
        .closest('[role="listitem"]')!;
      expect(nextRow.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        expandedRow.getBoundingClientRect().bottom,
      );
    } finally {
      measurements.restore();
    }
  });

  test("uses the whole root file row as a toggle with and without row actions", () => {
    for (const rowActions of [null, createRowActions("unstaged").actions]) {
      const { unmount } = render(<FileDiffListHarness file="root.ts" rowActions={rowActions} />);
      const toggle = fileToggle("root.ts");

      expect(toggle.style.minHeight).toBe(`${FILE_LIST_ROW_HEIGHT.list}px`);
      // The test DOM has no hit testing. The toggle layer covers its row, so the counts and the
      // space between the actions also toggle the diff in a browser.
      const row = toggle.parentElement;
      expect(toggle.className).toContain("after:absolute after:inset-0");
      expect(row?.className).toContain("relative");
      expect(row?.contains(screen.getByTestId("agent-studio-git-file-stats"))).toBe(true);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      unmount();
    }
  });

  test.each([
    ["unstaged", "stage", "Stage file", "Discard unstaged changes", "unstage"],
    ["staged", "unstage", "Unstage file", "Discard staged changes", "stage"],
  ] as const)(
    "%s rows %s and discard the file without toggling its diff",
    (group, toggleAction, toggleLabel, discardLabel, missingAction) => {
      const { actions, onChange } = createRowActions(group);
      render(<FileDiffListHarness file="root.ts" rowActions={actions} />);
      const toggle = fileToggle("root.ts");
      const toggleButton = screen.getByTestId(`agent-studio-git-${toggleAction}-file-button`);
      const discardButton = screen.getByTestId("agent-studio-git-discard-file-button");
      expect(toggleButton.getAttribute("aria-label")).toBe(toggleLabel);
      expect(discardButton.getAttribute("aria-label")).toBe(discardLabel);
      expect(screen.queryByTestId(`agent-studio-git-${missingAction}-file-button`)).toBeNull();

      fireEvent.click(toggleButton);
      fireEvent.click(discardButton);

      expect(onChange.mock.calls.map(([intent]) => intent)).toEqual([
        fileIntent(toggleAction, group, "root.ts"),
        fileIntent("discard", group, "root.ts"),
      ]);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    },
  );

  test.each([
    ["unstaged", "stage", ["View file", "Stage file", "Discard unstaged changes", "Copy path"]],
    ["staged", "unstage", ["View file", "Unstage file", "Discard staged changes", "Copy path"]],
  ] as const)(
    "opens the %s row menu from its button with the actions of the group",
    async (group, toggleAction, items) => {
      const { actions, onChange } = createRowActions(group);
      const viewFile = mock((_filePath: string) => {});
      render(<FileDiffListHarness file="root.ts" rowActions={actions} onViewFile={viewFile} />);
      const toggle = fileToggle("root.ts");

      let menu = await openRowMenu("root.ts");
      expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([...items]);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(menu.getByRole("menuitem", { name: items[1] }));
      expect(onChange).toHaveBeenLastCalledWith(fileIntent(toggleAction, group, "root.ts"));

      menu = await openRowMenu("root.ts");
      fireEvent.click(menu.getByRole("menuitem", { name: items[2] }));
      expect(onChange).toHaveBeenLastCalledWith(fileIntent("discard", group, "root.ts"));
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      menu = await openRowMenu("root.ts");
      fireEvent.click(menu.getByRole("menuitem", { name: "View file" }));
      expect(viewFile).toHaveBeenCalledWith("root.ts");
      expect(onChange).toHaveBeenCalledTimes(2);
      // View file opens the preview and leaves the diff closed.
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    },
  );

  test("offers no View file for a deleted file or a panel without file previews", async () => {
    const viewFile = mock((_filePath: string) => {});
    const { unmount } = render(
      <FileDiffListHarness file="root.ts" type="deleted" onViewFile={viewFile} />,
    );
    let menu = await openRowMenu("root.ts");
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Copy path"]);
    // A menu without items above Copy path has no separator.
    expect(menu.queryByRole("separator")).toBeNull();
    unmount();

    render(<FileDiffListHarness file="root.ts" />);
    menu = await openRowMenu("root.ts");
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Copy path"]);
    expect(viewFile).not.toHaveBeenCalled();
  });

  test("offers only View file and Copy path in the menu of a review-only list", async () => {
    const copied: string[] = [];
    const restoreClipboard = replaceNavigatorClipboard(async (value) => {
      copied.push(value);
    });
    try {
      render(<FileDiffListHarness file="root.ts" diffScope="target" onViewFile={() => {}} />);
      for (const action of ["stage", "unstage", "discard"]) {
        expect(screen.queryByTestId(`agent-studio-git-${action}-file-button`)).toBeNull();
      }
      expect(screen.getByTestId("agent-studio-git-file-menu-button")).toBeDefined();

      fireEvent.contextMenu(fileToggle("root.ts"), { button: 2, clientX: 20, clientY: 40 });
      const menu = within(await screen.findByTestId("agent-studio-git-file-menu"));
      expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "View file",
        "Copy path",
      ]);
      fireEvent.click(menu.getByRole("menuitem", { name: "Copy path" }));

      await waitFor(() => expect(copied).toEqual(["root.ts"]));
    } finally {
      restoreClipboard();
    }
  });

  test("blocks file, menu, and chunk actions while a reason applies", async () => {
    const reason = "Wait for the commit to finish.";
    const { actions, onChange } = createRowActions("unstaged", { disabledReason: reason });
    render(<FileDiffListHarness file="root.ts" rowActions={actions} />);
    const toggle = fileToggle("root.ts");

    for (const testId of [
      "agent-studio-git-stage-file-button",
      "agent-studio-git-discard-file-button",
    ]) {
      const button = screen.getByTestId(testId);
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(button.getAttribute("title")).toBe(reason);
      // The disabled action stays the pointer target above the row toggle.
      expect(button.className).toContain("disabled:pointer-events-auto");
      fireEvent.click(button);
    }
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const menu = await openRowMenu("root.ts");
    expect(menu.getByText(reason)).toBeDefined();
    for (const name of ["Stage file", "Discard unstaged changes"]) {
      const item = menu.getByRole("menuitem", { name });
      expect(item.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(item);
    }
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(menu.getByRole("menuitem", { name: "Stage file" }), { key: "Escape" });
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
    expect(viewerMock.mock.lastCall?.[0].hunkActionsDisabledReason).toBe(reason);
    expect(onChange).not.toHaveBeenCalled();
  });

  test.each([
    ["unstaged", ["discard", "stage"]],
    ["staged", ["discard", "unstage"]],
  ] as const)("gives the diff the %s chunk actions for one chunk", (group, actionIds) => {
    const { actions, onChange } = createRowActions(group);
    render(<FileDiffListHarness file="root.ts" rowActions={actions} />);
    fireEvent.click(fileToggle("root.ts"));

    expect(screen.queryByTestId("agent-studio-git-chunk-actions-unavailable")).toBeNull();
    const { hunkActions, hunkActionsDisabledReason } = viewerMock.mock.lastCall?.[0] ?? {};
    expect(hunkActions?.map((action) => action.id)).toEqual([...actionIds]);
    expect(hunkActionsDisabledReason).toBeNull();
    for (const action of hunkActions ?? []) action.onSelect(1);

    expect(onChange.mock.calls.map(([intent]) => intent)).toEqual(
      actionIds.map((action) => ({
        action,
        group,
        selection: { kind: "hunk", filePath: "root.ts", hunkIndex: 1 },
      })),
    );
  });

  test("turns off the chunk actions while a change runs", async () => {
    const { actions } = createRowActions("unstaged");
    const running = gitChangeIntentKey({
      action: "stage",
      group: "unstaged",
      selection: { kind: "file", filePath: "other.ts" },
    });
    const { rerender } = render(
      <FileDiffListHarness file="root.ts" rowActions={actions} changingKey={running} />,
    );
    fireEvent.click(fileToggle("root.ts"));
    await waitFor(() =>
      expect(viewerMock.mock.lastCall?.[0].hunkActionsDisabledReason).toBe(
        "Wait for the current change to finish.",
      ),
    );

    rerender(<FileDiffListHarness file="root.ts" rowActions={actions} changingKey={null} />);
    expect(viewerMock.mock.lastCall?.[0].hunkActionsDisabledReason).toBeNull();
  });

  test("names why a new file has no chunk actions", () => {
    const { actions, onChange } = createRowActions("unstaged");
    render(
      <FileDiffListHarness
        file="notes.md"
        type="added"
        diff={"@@ -0,0 +1 @@\n+notes\n"}
        rowActions={actions}
      />,
    );
    fireEvent.click(fileToggle("notes.md"));

    expect(screen.getByTestId("agent-studio-git-chunk-actions-unavailable").textContent).toBe(
      "New files change only as a whole file. Use the file actions.",
    );
    expect(viewerMock.mock.lastCall?.[0].hunkActions).toBeUndefined();

    fireEvent.click(screen.getByTestId("agent-studio-git-stage-file-button"));
    expect(onChange).toHaveBeenCalledWith(fileIntent("stage", "unstaged", "notes.md"));
  });

  test("keeps row expansion working while preload entries are mounted", () => {
    render(<FileDiffListHarness />);

    expect(preloaderMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ filePath: "src/example.ts" }),
    );
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));

    expect(screen.getByTestId("pierre-diff-viewer").textContent).toBe("src/example.ts");
    expect(preloaderMock).toHaveBeenCalledTimes(1);
  });

  test("keeps chat-only diff display props out of git panel rendering", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-diff-style")).toBe("unified");
    expect(viewer.getAttribute("data-diff-indicators")).toBe("");
    expect(viewer.getAttribute("data-height-mode")).toBe("");
    expect(viewer.getAttribute("data-line-overflow")).toBe("");
    expect(viewer.getAttribute("data-hunk-separators")).toBe("");
    expect(viewerMock.mock.calls[0]?.[0]).not.toHaveProperty("diffIndicators");
    expect(viewerMock.mock.calls[0]?.[0]).not.toHaveProperty("heightMode");
    expect(viewerMock.mock.calls[0]?.[0]).not.toHaveProperty("lineOverflow");
    expect(viewerMock.mock.calls[0]?.[0]).not.toHaveProperty("hunkSeparators");
  });

  test.each(["uncommitted", "target"] as const)(
    "adds, edits, cancels, and removes workspace comments in %s diffs",
    (scope) => {
      const ownerKey = toInlineCommentDraftStorageKey({
        workspaceId: "workspace-1",
        workspaceSessionId: "task-1",
      });
      render(
        <FileDiffListHarness
          ownerKey={ownerKey}
          diffScope={scope}
          commentPlaceholder="Add a comment for this chat"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
      fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
      fireEvent.change(screen.getByPlaceholderText("Add a comment for this chat"), {
        target: { value: "   " },
      });
      expect(
        screen.getByRole("button", { name: "Comment" }).getAttribute("disabled"),
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(fileDiffListDrafts().getState().getDraftCount(ownerKey)).toBe(0);
      fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
      fireEvent.change(screen.getByPlaceholderText("Add a comment for this chat"), {
        target: { value: "Workspace note" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByDisplayValue("Workspace note"), {
        target: { value: "Cancelled edit" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByText("Workspace note")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByDisplayValue("Workspace note"), {
        target: { value: "Saved edit" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(fileDiffListDrafts().getState().getPendingDrafts(ownerKey)[0]).toMatchObject({
        text: "Saved edit",
        diffScope: scope,
        startLine: 2,
        endLine: 3,
        side: "new",
      });
      expect(fileDiffListDrafts().getState().getDraftCount(OWNER_KEY)).toBe(0);
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(fileDiffListDrafts().getState().getDraftCount(ownerKey)).toBe(0);
    },
  );

  test("creates inline comments, updates file counters, and clears them after send success", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));

    expect(screen.getByTestId("agent-studio-git-new-comment-form")).toBeDefined();
    const saveButton = screen.getByRole("button", { name: "Comment" });
    expect(saveButton.getAttribute("disabled")).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Please tighten the null handling" },
    });
    fireEvent.click(saveButton);

    expect(screen.queryByTestId("agent-studio-git-new-comment-form")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-file-comment-count").textContent).toContain("1");
    const pendingComment = screen.getByTestId("agent-studio-git-pending-comment");
    expect(pendingComment.textContent).toContain("Please tighten the null handling");
    expect(pendingComment.closest('[data-testid="pierre-diff-annotation"]')).not.toBeNull();
    expect(screen.queryByTestId("agent-studio-git-unplaced-comments")).toBeNull();

    const sentSnapshot = fileDiffListDrafts()
      .getState()
      .getPendingDrafts(OWNER_KEY)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      const submissionId = fileDiffListDrafts()
        .getState()
        .beginSubmittingDrafts(OWNER_KEY, sentSnapshot);
      if (!submissionId) {
        throw new Error("Expected submission id");
      }
      fileDiffListDrafts().getState().completeSubmittingDrafts(submissionId);
    });

    expect(screen.queryByTestId("agent-studio-git-pending-comment")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-file-comment-count")).toBeNull();
  });

  test("shows a comment above the diff when its lines no longer hold the commented code", () => {
    const { rerender } = render(<FileDiffListHarness />);
    fireEvent.click(fileToggle("src/example.ts"));
    addCommentOnSelectedLines("Check this branch");
    expect(screen.getAllByTestId("pierre-diff-annotation")).toHaveLength(1);

    // The same line numbers now hold other code.
    rerender(
      <FileDiffListHarness diff={"@@ -1,2 +1,3 @@\n before\n-old\n+changed one\n+changed two\n"} />,
    );

    const unplaced = screen.getByTestId("agent-studio-git-unplaced-comments");
    expect(within(unplaced).getByTestId("agent-studio-git-pending-comment").textContent).toContain(
      "Check this branch",
    );
    expect(screen.queryAllByTestId("pierre-diff-annotation")).toHaveLength(0);
    expect(screen.getByTestId("agent-studio-git-file-comment-count").textContent).toContain("1");
    expect(fileDiffListDrafts().getState().getPendingDrafts(OWNER_KEY)).toHaveLength(1);
  });

  test("shows the comments that the parent places instead of every comment of the scope", () => {
    const { rerender } = render(<FileDiffListHarness commentsByFile={new Map()} />);
    fireEvent.click(fileToggle("src/example.ts"));
    addCommentOnSelectedLines("Placed by the parent");
    expect(screen.queryByTestId("agent-studio-git-pending-comment")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-file-comment-count")).toBeNull();

    const drafts = fileDiffListDrafts().getState().getPendingDrafts(OWNER_KEY);
    rerender(<FileDiffListHarness commentsByFile={new Map([["src/example.ts", drafts]])} />);

    expect(screen.getByTestId("agent-studio-git-pending-comment").textContent).toContain(
      "Placed by the parent",
    );
    expect(screen.getByTestId("agent-studio-git-file-comment-count").textContent).toContain("1");
  });

  test("disables edit and remove actions for submitted comments while send is in flight", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Please tighten the null handling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    const sentSnapshot = fileDiffListDrafts()
      .getState()
      .getPendingDrafts(OWNER_KEY)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      fileDiffListDrafts().getState().beginSubmittingDrafts(OWNER_KEY, sentSnapshot);
    });

    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByText("Sending")).toBeDefined();
  });

  test("clears an unsaved selection form when the diff scope changes for the same file row", () => {
    render(<ScopeSwitchFileDiffListHarness />);

    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    expect(screen.getByTestId("agent-studio-git-new-comment-form")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Switch scope" }));
    expect(screen.queryByTestId("agent-studio-git-new-comment-form")).toBeNull();
  });

  test("keeps an opened diff mounted but hidden when a scope change closes its row", () => {
    render(<ScopeSwitchFileDiffListHarness />);
    const viewer = screen.getByTestId("pierre-diff-viewer");

    fireEvent.click(screen.getByRole("button", { name: "Switch scope" }));

    expect(screen.getByTestId("pierre-diff-viewer")).toBe(viewer);
    expect(viewer.closest(".hidden")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    expect(screen.getByTestId("pierre-diff-viewer")).toBe(viewer);
    expect(viewer.closest(".hidden")).toBeNull();
  });

  test("clears an unsaved selection form when the comment owner changes for the same file row", () => {
    render(<OwnerSwitchFileDiffListHarness />);

    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    expect(screen.getByTestId("agent-studio-git-new-comment-form")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Switch owner" }));
    expect(screen.queryByTestId("agent-studio-git-new-comment-form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch owner" }));
    expect(screen.queryByTestId("agent-studio-git-new-comment-form")).toBeNull();
  });

  test("keeps comments isolated to the diff scope they were created in", () => {
    render(<ScopeSwitchFileDiffListHarness />);

    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Only for uncommitted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(screen.getByTestId("agent-studio-git-file-comment-count").textContent).toContain("1");
    expect(screen.getByTestId("agent-studio-git-pending-comment").textContent).toContain(
      "Only for uncommitted",
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch scope" }));

    expect(screen.queryByTestId("agent-studio-git-pending-comment")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-file-comment-count")).toBeNull();
  });
});
