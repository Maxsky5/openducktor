import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactElement, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

type FileDiffListComponent = typeof import("./file-diff-list")["FileDiffList"];

let FileDiffList: FileDiffListComponent;

const reactActEnvironmentGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

const preloaderMock = mock(({ filePath }: { filePath: string }) => (
  <div data-testid="pierre-diff-preloader">{filePath}</div>
));

const viewerMock = mock(
  ({
    filePath,
    onLineSelectionEnd,
  }: {
    filePath: string;
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
  }) => (
    <div>
      <div data-testid="pierre-diff-viewer">{filePath}</div>
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
    </div>
  ),
);

const resetInlineComments = (): void => {
  useInlineCommentDraftStore.setState({ drafts: [], draftStateKey: null, submittingDrafts: [] });
};

beforeAll(async () => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
    PierreDiffPreloader: preloaderMock,
    PierreDiffViewer: viewerMock,
  }));

  ({ FileDiffList } = await import("./file-diff-list"));

  await restoreMockedModules([
    [
      "@/components/features/agents/pierre-diff-viewer",
      () => import("@/components/features/agents/pierre-diff-viewer"),
    ],
  ]);
});

afterEach(() => {
  cleanup();
  preloaderMock.mockClear();
  viewerMock.mockClear();
  resetInlineComments();
});

afterAll(() => {
  if (typeof previousActEnvironmentValue === "undefined") {
    delete reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
  } else {
    reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironmentValue;
  }
});

function FileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  return (
    <TooltipProvider>
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

function ScopeSwitchFileDiffListHarness(): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["src/example.ts"]));
  const [diffScope, setDiffScope] = useState<"uncommitted" | "target">("uncommitted");

  return (
    <TooltipProvider>
      <button type="button" onClick={() => setDiffScope("target")}>
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

describe("FileDiffList", () => {
  test("keeps row expansion working while preload entries are mounted", () => {
    render(<FileDiffListHarness />);

    expect(screen.getByTestId("pierre-diff-preloader").textContent).toBe("src/example.ts");
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));

    expect(screen.getByTestId("pierre-diff-viewer").textContent).toBe("src/example.ts");
    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
  });

  test("creates inline comments, updates file counters, and shows sent comments after send success", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));

    expect(screen.getByTestId("agent-studio-git-new-comment-form")).toBeDefined();
    const saveButton = screen.getByRole("button", { name: "Save comment" });
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
      .getPendingDrafts()
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      useInlineCommentDraftStore.getState().markDraftsAsSent(sentSnapshot);
    });

    expect(screen.queryByTestId("agent-studio-git-pending-comment")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-sent-comment-trigger").textContent).toContain(
      "Please tighten the null handling",
    );
  });

  test("disables edit and remove actions for submitted comments while send is in flight", () => {
    render(<FileDiffListHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for src/example.ts" }));
    fireEvent.click(screen.getByTestId("pierre-diff-select-lines"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment for the Builder"), {
      target: { value: "Please tighten the null handling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

    const sentSnapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts()
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    act(() => {
      useInlineCommentDraftStore.getState().beginSubmittingDrafts(sentSnapshot);
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
});
