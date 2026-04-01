import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

let FileDiffList: typeof import("./file-diff-list").FileDiffList;

const buildDiff = (file: string, diff: string): FileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff,
});

beforeAll(async () => {
  mock.module("@/components/ui/tooltip", () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }));
  mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
    PierreDiffPreloader: ({ filePath }: { filePath: string }) => (
      <div data-testid="mock-pierre-diff-preloader">{filePath}</div>
    ),
    PierreDiffViewer: ({ filePath }: { filePath: string }) => (
      <div data-testid="mock-pierre-diff-viewer">{filePath}</div>
    ),
  }));

  ({ FileDiffList } = await import("./file-diff-list"));
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  mock.restore();
});

describe("FileDiffList", () => {
  test("does not mount hidden diff preloaders for collapsed files", () => {
    render(
      <FileDiffList
        fileDiffs={[
          buildDiff("src/a.ts", "@@ -1 +1 @@\n-a\n+b"),
          buildDiff("src/b.ts", "@@ -1 +1 @@\n-old\n+new"),
        ]}
        conflictedFiles={new Set()}
        diffStyle="unified"
        setDiffStyle={() => {}}
        expandedFiles={new Set()}
        onToggleFile={() => {}}
        canResetFiles={false}
        isResetDisabled={true}
        resetDisabledReason={null}
      />,
    );

    expect(screen.queryByTestId("mock-pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("mock-pierre-diff-viewer")).toBeNull();
  });

  test("renders viewers only for expanded files", () => {
    render(
      <FileDiffList
        fileDiffs={[
          buildDiff("src/a.ts", "@@ -1 +1 @@\n-a\n+b"),
          buildDiff("src/b.ts", "@@ -1 +1 @@\n-old\n+new"),
        ]}
        conflictedFiles={new Set()}
        diffStyle="split"
        setDiffStyle={() => {}}
        expandedFiles={new Set(["src/b.ts"])}
        onToggleFile={() => {}}
        canResetFiles={false}
        isResetDisabled={true}
        resetDisabledReason={null}
      />,
    );

    expect(screen.queryByTestId("mock-pierre-diff-preloader")).toBeNull();
    expect(screen.getByTestId("mock-pierre-diff-viewer").textContent).toBe("src/b.ts");
  });
});
