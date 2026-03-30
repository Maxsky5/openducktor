import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileEditData } from "./agent-chat-message-card-model";

let AgentChatFileEditCard: typeof import("./agent-chat-file-edit-card").AgentChatFileEditCard;

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

beforeAll(async () => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
    PierreDiffPreloader: preloaderMock,
    PierreDiffViewer: viewerMock,
  }));

  ({ AgentChatFileEditCard } = await import("./agent-chat-file-edit-card"));
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

  mock.restore();
});

describe("AgentChatFileEditCard", () => {
  test("does not mount the hidden diff preloader while collapsed", () => {
    render(<AgentChatFileEditCard data={buildFileEditData()} />);

    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });

  test("renders the visible diff viewer after expansion with the existing split view props", () => {
    render(<AgentChatFileEditCard data={buildFileEditData()} />);

    fireEvent.click(screen.getByRole("button", { name: /example\.ts/i }));

    const viewer = screen.getByTestId("pierre-diff-viewer");
    expect(viewer.getAttribute("data-file-path")).toBe("src/example.ts");
    expect(viewer.getAttribute("data-patch")).toBe("@@ -1 +1 @@\n-old\n+new\n");
    expect(viewer.getAttribute("data-diff-style")).toBe("split");
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).toHaveBeenCalledTimes(1);
  });

  test("keeps no-diff cards on the metadata-only path", () => {
    render(
      <AgentChatFileEditCard
        data={buildFileEditData({
          diff: null,
          filePath: "src/no-diff.ts",
          additions: 0,
          deletions: 0,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /no-diff\.ts/i })).toBeDefined();
    expect(screen.queryByTestId("pierre-diff-preloader")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-viewer")).toBeNull();
    expect(preloaderMock).not.toHaveBeenCalled();
    expect(viewerMock).not.toHaveBeenCalled();
  });
});
