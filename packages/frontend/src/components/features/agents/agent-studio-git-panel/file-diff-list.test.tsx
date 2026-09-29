import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactElement, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";

const OWNER_KEY = toInlineCommentDraftStorageKey({ workspaceId: "workspace-1", taskId: "task-1" });
const OTHER_OWNER_KEY = toInlineCommentDraftStorageKey({
  workspaceId: "workspace-1",
  taskId: "task-2",
});

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const pierreDiffViewerModule = await import("@/components/features/agents/pierre-diff-viewer");
type RestorableSpy = { mockRestore(): void };
let pierreViewerSpies: RestorableSpy[] = [];

type FileDiffListComponent = (typeof import("./file-diff-list"))["FileDiffList"];

let FileDiffList: FileDiffListComponent;

const reactActEnvironmentGlobal: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

const preloaderMock = mock((_props: { patch: string; filePath: string }) => null);

const fileViewerMock = mock(
  ({ content, filePath }: { content: string; filePath: string; className?: string }) => (
    <div data-testid="pierre-file-viewer" data-content={content} data-file-path={filePath}>
      {content}
    </div>
  ),
);

const viewerMock = mock(
  ({
    diffStyle,
    filePath,
    diffIndicators,
    heightMode,
    hunkSeparators,
    lineOverflow,
    onLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
  }: {
    diffStyle?: string;
    filePath: string;
    diffIndicators?: string;
    heightMode?: string;
    lineOverflow?: string;
    hunkSeparators?: string;
    onLineSelectionEnd?:
      | ((
          selection: {
            selectedLines: { start: number; end: number; side: "additions"; endSide: "additions" };
            side: "new";
            startLine: number;
            endLine: number;
            codeContext: Array<{ lineNumber: number; text: string; isSelected: boolean }>;
            language: string | null;
          } | null,
        ) => void)
      | undefined;
    lineAnnotations?: Array<{
      side: "additions" | "deletions";
      lineNumber: number;
      metadata: unknown;
    }>;
    renderAnnotation?:
      | ((annotation: {
          side: "additions" | "deletions";
          lineNumber: number;
          metadata: unknown;
        }) => ReactElement | null)
      | undefined;
  }) => (
    <div>
      <div
        data-testid="pierre-diff-viewer"
        data-diff-indicators={diffIndicators ?? ""}
        data-diff-style={diffStyle ?? ""}
        data-height-mode={heightMode ?? ""}
        data-hunk-separators={hunkSeparators ?? ""}
        data-line-overflow={lineOverflow ?? ""}
      >
        {filePath}
      </div>
      <button
        type="button"
        data-testid="pierre-diff-select-lines"
        onClick={() =>
          onLineSelectionEnd?.({
            selectedLines: { start: 2, end: 3, side: "additions", endSide: "additions" },
            side: "new",
            startLine: 2,
            endLine: 3,
            codeContext: [
              { lineNumber: 1, text: "before", isSelected: false },
              { lineNumber: 2, text: "selected one", isSelected: true },
              { lineNumber: 3, text: "selected two", isSelected: true },
            ],
            language: "ts",
          })
        }
      >
        Select lines
      </button>
      <div data-testid="pierre-diff-annotations">
        {(lineAnnotations ?? []).map((annotation) => (
          <div
            key={`${annotation.side}-${annotation.lineNumber}-${JSON.stringify(annotation.metadata)}`}
            data-testid="pierre-diff-annotation"
          >
            {renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    </div>
  ),
);

const resetInlineComments = (): void => {
  resetInlineCommentDraftStoreForTests();
};

beforeEach(async () => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  resetInlineCommentDraftStoreForTests();
  setInlineCommentDraftStorageForTests(createMemoryStorage());
  setInlineCommentDraftScheduleTaskForTests(() => () => {});

  pierreViewerSpies = [
    spyOn(pierreDiffViewerModule, "PierreDiffPreloader").mockImplementation(
      Object.assign(preloaderMock, {
        $$typeof: pierreDiffViewerModule.PierreDiffPreloader.$$typeof,
        type: preloaderMock,
      }),
    ),
    spyOn(pierreDiffViewerModule, "PierreDiffViewer").mockImplementation(
      Object.assign(viewerMock, {
        $$typeof: pierreDiffViewerModule.PierreDiffViewer.$$typeof,
        type: viewerMock,
      }),
    ),
    spyOn(pierreDiffViewerModule, "PierreFileViewer").mockImplementation(
      Object.assign(fileViewerMock, {
        $$typeof: pierreDiffViewerModule.PierreFileViewer.$$typeof,
        type: fileViewerMock,
      }),
    ),
  ];

  ({ FileDiffList } = await import("./file-diff-list"));
});

afterEach(() => {
  for (const pierreViewerSpy of pierreViewerSpies) pierreViewerSpy.mockRestore();
  pierreViewerSpies = [];
  cleanup();
  preloaderMock.mockClear();
  viewerMock.mockClear();
  fileViewerMock.mockClear();
  resetInlineComments();
});

afterAll(() => {
  if (previousActEnvironmentValue === undefined) {
    delete reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
  } else {
    reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironmentValue;
  }
});

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

function installMeasuredRows() {
  const previousResizeObserver = globalThis.ResizeObserver;
  const observers: Array<{
    callback: ResizeObserverCallback;
    elements: Set<Element>;
    observer: ResizeObserver;
  }> = [];
  const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const previousOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  let currentWidth = 600;
  let currentExpandedRowHeight = 800;
  const rowHeight = (element: Element): number =>
    element
      .querySelector('[data-testid="agent-studio-git-file-toggle-button"]')
      ?.getAttribute("aria-expanded") === "true"
      ? currentExpandedRowHeight
      : 40;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: function (this: HTMLElement) {
      if (this.getAttribute("role") === "listitem") {
        return rowHeight(this);
      }
      return previousOffsetHeight?.get?.call(this) ?? 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute("role") === "list") return new DOMRect(0, 0, currentWidth, 400);
    if (this.getAttribute("role") === "listitem") {
      const rowStart = Number(/translateY\((\d+)px\)/.exec(this.style.transform)?.[1] ?? 0);
      const height = rowHeight(this);
      return new DOMRect(0, rowStart - (this.parentElement?.scrollTop ?? 0), currentWidth, height);
    }
    return previousGetBoundingClientRect.call(this);
  };
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly controller: (typeof observers)[number];

    constructor(callback: ResizeObserverCallback) {
      this.controller = { callback, elements: new Set(), observer: this };
      observers.push(this.controller);
    }

    observe(element: Element): void {
      this.controller.elements.add(element);
    }

    unobserve(element: Element): void {
      this.controller.elements.delete(element);
    }

    disconnect(): void {
      this.controller.elements.clear();
    }
  };

  return {
    resize: (width: number, expandedRowHeight: number, passes = 3) => {
      currentWidth = width;
      currentExpandedRowHeight = expandedRowHeight;
      for (let pass = 0; pass < passes; pass++) {
        act(() => {
          for (const observer of observers) {
            const entries = Array.from(observer.elements, (element) => {
              const isList = element.getAttribute("role") === "list";
              const height = rowHeight(element);
              const boxSize = { blockSize: height, inlineSize: width };
              return {
                target: element,
                contentRect: new DOMRect(0, 0, width, isList ? 400 : height),
                borderBoxSize: [boxSize],
                contentBoxSize: [boxSize],
                devicePixelContentBoxSize: [boxSize],
              } satisfies ResizeObserverEntry;
            });
            observer.callback(entries, observer.observer);
          }
        });
        for (const observer of observers) {
          for (const element of observer.elements) {
            if (element.getAttribute("role") === "list") fireEvent.scroll(element);
          }
        }
      }
    },
    restore: () => {
      globalThis.ResizeObserver = previousResizeObserver;
      HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect;
      if (previousOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", previousOffsetHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    },
  };
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
