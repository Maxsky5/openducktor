import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
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

const viewerMock = mock(({ filePath }: { filePath: string }) => (
  <div data-testid="pierre-diff-viewer">{filePath}</div>
));

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
});
