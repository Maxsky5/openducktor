import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { FileEditData } from "./agent-chat-message-card-model";

let AgentChatFileEditCard: typeof import("./agent-chat-file-edit-card").AgentChatFileEditCard;
let AgentChatSettingsProvider: typeof import("./agent-chat-settings-context").AgentChatSettingsProvider;

const preloaderMock = mock(({ filePath }: { patch: string; filePath: string }) => (
  <div data-testid="pierre-diff-preloader">{filePath}</div>
));

const viewerMock = mock(
  ({ diffStyle, filePath, patch }: { patch: string; filePath: string; diffStyle?: string }) => (
    <div
      data-testid="pierre-diff-viewer"
      data-diff-style={diffStyle ?? ""}
      data-file-path={filePath}
      data-patch={patch}
    >
      {filePath}
    </div>
  ),
);

const reactActEnvironmentGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

const buildFileEditData = (overrides: Partial<FileEditData> = {}): FileEditData => ({
  filePath: "src/example.ts",
  diff: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  ...overrides,
});

const buildChatSettings = (expandFileDiffsByDefault: boolean) => ({
  showThinkingMessages: false,
  expandFileDiffsByDefault,
});

const fileEditCardElement = (
  data: FileEditData,
  expandFileDiffsByDefault: boolean,
): ReactElement => (
  <AgentChatSettingsProvider value={buildChatSettings(expandFileDiffsByDefault)}>
    <AgentChatFileEditCard data={data} />
  </AgentChatSettingsProvider>
);

const renderFileEditCard = (data: FileEditData, expandFileDiffsByDefault: boolean) =>
  render(fileEditCardElement(data, expandFileDiffsByDefault));

beforeEach(async () => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
    PierreDiffPreloader: preloaderMock,
    PierreDiffViewer: viewerMock,
  }));

  ({ AgentChatFileEditCard } = await import("./agent-chat-file-edit-card"));
  ({ AgentChatSettingsProvider } = await import("./agent-chat-settings-context"));
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

afterEach(async () => {
  await restoreMockedModules([
    [
      "@/components/features/agents/pierre-diff-viewer",
      () => import("@/components/features/agents/pierre-diff-viewer"),
    ],
  ]);
});

describe("AgentChatFileEditCard", () => {
  test("does not mount the hidden diff preloader while collapsed", () => {
    renderFileEditCard(buildFileEditData(), false);

    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("renders the visible diff viewer immediately when diffs expand by default", () => {
    renderFileEditCard(buildFileEditData(), true);

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-file-path")).toBe("src/example.ts");
    expect(viewer.getAttribute("data-patch")).toBe("@@ -1 +1 @@\n-old\n+new\n");
    expect(viewer.getAttribute("data-diff-style")).toBe("split");
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).toHaveBeenCalledTimes(1);
  });

  test("renders the visible diff viewer after expansion with the existing split view props", () => {
    renderFileEditCard(buildFileEditData(), false);

    fireEvent.click(screen.getByRole("button", { name: /example\.ts/i }));

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-file-path")).toBe("src/example.ts");
    expect(viewer.getAttribute("data-patch")).toBe("@@ -1 +1 @@\n-old\n+new\n");
    expect(viewer.getAttribute("data-diff-style")).toBe("split");
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).toHaveBeenCalledTimes(1);
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
      buildFileEditData({
        diff: null,
        filePath: "src/no-diff.ts",
        additions: 0,
        deletions: 0,
      }),
      expandFileDiffsByDefault,
    );

    expect(screen.getByRole("button", { name: /no-diff\.ts/i })).toBeDefined();
    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });
});
