import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { FileEditData } from "./agent-chat-message-card-model";

let AgentChatFileEditCard: typeof import("./agent-chat-file-edit-card").AgentChatFileEditCard;
let AgentChatSettingsProvider: typeof import("./agent-chat-settings-context").AgentChatSettingsProvider;

const preloaderMock = mock(({ filePath }: { patch: string; filePath: string }) => (
  <div data-testid="pierre-diff-preloader">{filePath}</div>
));

type DiffViewerMockProps = {
  patch: string;
  filePath: string;
  diffStyle?: string;
  diffIndicators?: string;
  heightMode?: string;
  lineOverflow?: string;
  hunkSeparators?: string;
};

const DiffViewerMock = ({
  diffIndicators,
  diffStyle,
  filePath,
  heightMode,
  hunkSeparators,
  lineOverflow,
  patch,
}: DiffViewerMockProps) => (
  <div
    data-testid="pierre-diff-viewer"
    data-diff-indicators={diffIndicators ?? ""}
    data-diff-style={diffStyle ?? ""}
    data-file-path={filePath}
    data-height-mode={heightMode ?? ""}
    data-hunk-separators={hunkSeparators ?? ""}
    data-line-overflow={lineOverflow ?? ""}
    data-patch={patch}
  >
    {filePath}
  </div>
);

const viewerMock = mock(DiffViewerMock);
const preloadedViewerMock = mock(DiffViewerMock);

const fileViewerMock = mock(
  ({ content, filePath }: { content: string; filePath: string; className?: string }) => (
    <div data-testid="pierre-file-viewer" data-content={content} data-file-path={filePath}>
      {content}
    </div>
  ),
);

const reactActEnvironmentGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

type DiffFileEditData = Extract<FileEditData, { kind: "diff" }>;
type ContentFileEditData = Extract<FileEditData, { kind: "content" }>;
type PathFileEditData = Extract<FileEditData, { kind: "path" }>;

const buildFileEditData = (overrides: Partial<DiffFileEditData> = {}): DiffFileEditData => ({
  kind: "diff",
  filePath: "src/example.ts",
  diff: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  ...overrides,
});

const buildContentFileEditData = (
  overrides: Partial<ContentFileEditData> = {},
): ContentFileEditData => ({
  kind: "content",
  filePath: "src/example.ts",
  content: "export const value = 1;\n",
  changeType: "modified",
  additions: 0,
  deletions: 0,
  ...overrides,
});

const buildPathFileEditData = (overrides: Partial<PathFileEditData> = {}): PathFileEditData => ({
  kind: "path",
  filePath: "src/no-diff.ts",
  additions: 0,
  deletions: 0,
  ...overrides,
});

const buildChatSettings = (
  expandFileDiffsByDefault: boolean,
  overrides: Partial<ChatSettings> = {},
): ChatSettings => createChatSettingsFixture({ expandFileDiffsByDefault, ...overrides });

const fileEditCardElement = (
  data: FileEditData,
  expandFileDiffsByDefault: boolean,
  chatOverrides: Partial<ChatSettings> = {},
): ReactElement => (
  <AgentChatSettingsProvider value={buildChatSettings(expandFileDiffsByDefault, chatOverrides)}>
    <AgentChatFileEditCard data={data} />
  </AgentChatSettingsProvider>
);

const renderFileEditCard = (
  data: FileEditData,
  expandFileDiffsByDefault: boolean,
  chatOverrides: Partial<ChatSettings> = {},
) => render(fileEditCardElement(data, expandFileDiffsByDefault, chatOverrides));

beforeEach(async () => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
    PierreDiffPreloader: preloaderMock,
    PierrePreloadedDiffViewer: preloadedViewerMock,
    PierreDiffViewer: viewerMock,
    PierreFileViewer: fileViewerMock,
  }));

  ({ AgentChatFileEditCard } = await import("./agent-chat-file-edit-card"));
  ({ AgentChatSettingsProvider } = await import("./agent-chat-settings-context"));
});

afterEach(() => {
  cleanup();
  preloaderMock.mockClear();
  preloadedViewerMock.mockClear();
  viewerMock.mockClear();
  fileViewerMock.mockClear();
});

afterAll(() => {
  if (typeof previousActEnvironmentValue === "undefined") {
    delete reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
  } else {
    reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironmentValue;
  }
});

afterEach(async () => {
  await restoreMockedModules([
    [
      "@/components/features/agents/pierre-diff-viewer",
      () => import("@/components/features/agents/pierre-diff-viewer"),
    ],
  ]);
});

describe("AgentChatFileEditCard", () => {
  test("uses the cache-aware viewer for a newly displayed transcript diff", () => {
    renderFileEditCard(buildFileEditData(), true);

    expect(preloadedViewerMock).toHaveBeenCalledTimes(1);
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("does not mount the hidden diff preloader while collapsed", () => {
    renderFileEditCard(buildFileEditData(), false);

    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(preloadedViewerMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("renders the visible diff viewer immediately when diffs expand by default", () => {
    renderFileEditCard(buildFileEditData(), true);

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-file-path")).toBe("src/example.ts");
    expect(viewer.getAttribute("data-patch")).toBe("@@ -1 +1 @@\n-old\n+new\n");
    expect(viewer.getAttribute("data-diff-style")).toBe("split");
    expect(viewer.getAttribute("data-diff-indicators")).toBe("bars");
    expect(viewer.getAttribute("data-height-mode")).toBe("full");
    expect(viewer.getAttribute("data-line-overflow")).toBe("wrap");
    expect(viewer.getAttribute("data-hunk-separators")).toBe("line-info");
    expect(viewer.parentElement).toBe(screen.getByTestId("agent-chat-file-edit-card"));
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(preloadedViewerMock).toHaveBeenCalledTimes(1);
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("renders the visible diff viewer after expansion with default chat diff settings", () => {
    renderFileEditCard(buildFileEditData(), false);

    fireEvent.click(screen.getByRole("button", { name: /example\.ts/i }));

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-file-path")).toBe("src/example.ts");
    expect(viewer.getAttribute("data-patch")).toBe("@@ -1 +1 @@\n-old\n+new\n");
    expect(viewer.getAttribute("data-diff-style")).toBe("split");
    expect(viewer.getAttribute("data-diff-indicators")).toBe("bars");
    expect(viewer.getAttribute("data-height-mode")).toBe("full");
    expect(viewer.getAttribute("data-line-overflow")).toBe("wrap");
    expect(viewer.getAttribute("data-hunk-separators")).toBe("line-info");
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(preloadedViewerMock).toHaveBeenCalledTimes(1);
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("passes explicit chat diff display settings to expanded transcript diffs", () => {
    renderFileEditCard(buildFileEditData(), true, {
      diffStyle: "unified",
      diffIndicators: "none",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "simple",
    });

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-diff-style")).toBe("unified");
    expect(viewer.getAttribute("data-diff-indicators")).toBe("none");
    expect(viewer.getAttribute("data-height-mode")).toBe("scroll");
    expect(viewer.getAttribute("data-line-overflow")).toBe("scroll");
    expect(viewer.getAttribute("data-hunk-separators")).toBe("simple");
  });

  test("renders full file content without invoking the diff viewer", () => {
    renderFileEditCard(
      buildContentFileEditData({
        filePath: "src/AuthContext.test.tsx",
        content: "export const value = 1;\n",
      }),
      true,
    );

    expect(screen.getByText("export const value = 1;")).toBeDefined();
    expect(screen.getByTestId("pierre-file-viewer").getAttribute("data-file-path")).toBe(
      "src/AuthContext.test.tsx",
    );
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloadedViewerMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
    expect(fileViewerMock).toHaveBeenCalledTimes(1);
  });

  test("treats empty file content as expandable content", () => {
    renderFileEditCard(
      buildContentFileEditData({
        content: "",
      }),
      true,
    );

    expect(screen.getByTestId("pierre-file-viewer").getAttribute("data-content")).toBe("");
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
  });

  test("uses full-file content change type for the status badge", () => {
    renderFileEditCard(
      buildContentFileEditData({
        changeType: "deleted",
      }),
      true,
    );

    expect(screen.getByText("D")).toBeDefined();
  });

  test("collapses an expanded diff card without changing metadata", () => {
    renderFileEditCard(buildFileEditData(), true);

    expect(screen.getByTestId("pierre-diff-viewer")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /example\.ts/i }));

    expect(screen.getByRole("button", { name: /example\.ts/i })).toBeDefined();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
  });

  test("syncs default expansion changes until the user toggles the card", async () => {
    const data = buildFileEditData();
    const { rerender } = renderFileEditCard(data, true);

    expect(screen.getByTestId("pierre-diff-viewer")).toBeDefined();

    rerender(fileEditCardElement(data, false));

    await waitFor(() => {
      expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    });
  });

  test("updates an already expanded diff card when chat diff settings change", () => {
    const data = buildFileEditData();
    const { rerender } = renderFileEditCard(data, true);

    expect(screen.getByTestId("pierre-diff-viewer").getAttribute("data-height-mode")).toBe("full");

    rerender(
      fileEditCardElement(data, true, {
        diffStyle: "unified",
        diffIndicators: "classic",
        diffHeight: "scroll",
        lineOverflow: "scroll",
        hunkSeparators: "metadata",
      }),
    );

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-diff-style")).toBe("unified");
    expect(viewer.getAttribute("data-diff-indicators")).toBe("classic");
    expect(viewer.getAttribute("data-height-mode")).toBe("scroll");
    expect(viewer.getAttribute("data-line-overflow")).toBe("scroll");
    expect(viewer.getAttribute("data-hunk-separators")).toBe("metadata");
  });

  test("keeps the user's manual collapsed state when defaults change", () => {
    const data = buildFileEditData();
    const { rerender } = renderFileEditCard(data, true);

    fireEvent.click(screen.getByRole("button", { name: /example\.ts/i }));
    rerender(fileEditCardElement(data, false));
    rerender(fileEditCardElement(data, true));

    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
  });

  test.each([
    true,
    false,
  ])("keeps no-diff cards on the metadata-only path when expandFileDiffsByDefault is %p", (expandFileDiffsByDefault) => {
    renderFileEditCard(
      buildPathFileEditData({
        filePath: "src/no-diff.ts",
      }),
      expandFileDiffsByDefault,
    );

    expect(screen.getByRole("button", { name: /no-diff\.ts/i })).toBeDefined();
    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(preloadedViewerMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });
});
