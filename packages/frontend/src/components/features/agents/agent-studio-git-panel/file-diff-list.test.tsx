import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactElement, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import { FileDiffList } from "./file-diff-list";
import {
  installMeasuredRows,
  OWNER_KEY,
  preloaderMock,
  setupFileDiffListTests,
  viewerMock,
} from "./file-diff-list.test-support";
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
} as const;

function FileDiffListHarness({
  file = "src/example.ts",
  canResetFiles = false,
  isResetDisabled = false,
  onRequestFileReset,
}: {
  file?: string;
  canResetFiles?: boolean;
  isResetDisabled?: boolean;
  onRequestFileReset?: (filePath: string) => void;
} = {}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  return (
    <TooltipProvider>
      <FileDiffList
        {...LIST_VIEW_PROPS}
        fileDiffs={[
          {
            file,
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ]}
        diffScope="uncommitted"
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
        canResetFiles={canResetFiles}
        isResetDisabled={isResetDisabled}
        resetDisabledReason={null}
        onRequestFileReset={onRequestFileReset}
      />
    </TooltipProvider>
  );
}

function ScopeSwitchFileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/example.ts"]));
  const [diffScope, setDiffScope] = useState<"uncommitted" | "target">("uncommitted");

  return (
    <TooltipProvider>
      <button
        type="button"
        onClick={() => {
          setDiffScope("target");
          setExpandedFiles(new Set());
        }}
      >
        Switch scope
      </button>
      <FileDiffList
        {...LIST_VIEW_PROPS}
        fileDiffs={[
          {
            file: "src/example.ts",
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ]}
        diffScope={diffScope}
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
        canResetFiles={false}
        isResetDisabled={false}
        resetDisabledReason={null}
      />
    </TooltipProvider>
  );
}

function OwnerSwitchFileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/example.ts"]));
  const [ownerKey, setOwnerKey] = useState(OWNER_KEY);

  return (
    <TooltipProvider>
      <button type="button" onClick={() => setOwnerKey(OTHER_OWNER_KEY)}>
        Switch owner
      </button>
      <FileDiffList
        {...LIST_VIEW_PROPS}
        fileDiffs={[
          {
            file: "src/example.ts",
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ]}
        diffScope="uncommitted"
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
        canResetFiles={false}
        isResetDisabled={false}
        resetDisabledReason={null}
      />
    </TooltipProvider>
  );
}

function LargeFileDiffListHarness(): ReactElement {
  const [fileCount, setFileCount] = useState(1_000);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/file-000.ts"]));
  const fileDiffs = useMemo(
    () =>
      Array.from({ length: fileCount }, (_, index) => ({
        file: `src/file-${String(index).padStart(3, "0")}.ts`,
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      })),
    [fileCount],
  );

  return (
    <TooltipProvider>
      <button type="button" onClick={() => setFileCount(20)}>
        Shorten list
      </button>
      <div className="h-[400px]">
        <FileDiffList
          {...LIST_VIEW_PROPS}
          fileDiffs={fileDiffs}
          diffScope="uncommitted"
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
          canResetFiles={false}
          isResetDisabled={false}
          resetDisabledReason={null}
        />
      </div>
    </TooltipProvider>
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
    <TooltipProvider>
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
        <FileDiffList
          {...LIST_VIEW_PROPS}
          fileDiffs={fileDiffs}
          diffScope="uncommitted"
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
          canResetFiles={false}
          isResetDisabled={false}
          resetDisabledReason={null}
        />
      </div>
    </TooltipProvider>
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
    expect(screen.getByText("1000 changed files")).toBeDefined();
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

    expect(screen.getByText("20 changed files")).toBeDefined();
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

  test("uses the whole root file row as a toggle while reset stays separate", () => {
    for (const canResetFiles of [false, true]) {
      const requestFileReset = mock((_filePath: string) => {});
      const { unmount } = render(
        <FileDiffListHarness
          file="root.ts"
          canResetFiles={canResetFiles}
          onRequestFileReset={requestFileReset}
        />,
      );
      const toggle = screen.getByRole("button", { name: "Toggle diff for root.ts" });

      expect(toggle.className).toContain("min-h-10");
      expect(toggle.className).toContain("w-full");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(screen.getByTestId("agent-studio-git-file-stats"));
      expect(toggle.getAttribute("aria-expanded")).toBe("true");

      if (canResetFiles) {
        fireEvent.click(screen.getByRole("button", { name: "Reset file" }));
        expect(requestFileReset).toHaveBeenCalledWith("root.ts");
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
      }

      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      unmount();
    }
  });

  test("keeps a disabled Reset as the pointer target above the row toggle", () => {
    const requestFileReset = mock((_filePath: string) => {});
    render(
      <FileDiffListHarness
        file="root.ts"
        canResetFiles
        isResetDisabled
        onRequestFileReset={requestFileReset}
      />,
    );

    const resetButton = screen.getByRole("button", { name: "Reset file" });
    const toggle = screen.getByRole("button", { name: "Toggle diff for root.ts" });
    expect(resetButton.hasAttribute("disabled")).toBe(true);
    expect(resetButton.className).toContain("disabled:pointer-events-auto");

    fireEvent.click(resetButton);
    expect(requestFileReset).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
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
    expect(screen.getByTestId("agent-studio-git-pending-comment").textContent).toContain(
      "Please tighten the null handling",
    );

    const sentSnapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts(OWNER_KEY)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      const submissionId = useInlineCommentDraftStore
        .getState()
        .beginSubmittingDrafts(OWNER_KEY, sentSnapshot);
      if (!submissionId) {
        throw new Error("Expected submission id");
      }
      useInlineCommentDraftStore.getState().completeSubmittingDrafts(submissionId);
    });

    expect(screen.queryByTestId("agent-studio-git-pending-comment")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-file-comment-count")).toBeNull();
  });

  test("disables edit and remove actions for submitted comments while send is in flight", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Please tighten the null handling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    const sentSnapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts(OWNER_KEY)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      useInlineCommentDraftStore.getState().beginSubmittingDrafts(OWNER_KEY, sentSnapshot);
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
