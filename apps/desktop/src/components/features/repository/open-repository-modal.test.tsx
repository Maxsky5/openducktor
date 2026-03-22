import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const pickRepositoryDirectoryMock = mock(async (): Promise<string | null> => "/repo");
const addWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});
const selectWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});

mock.module("@/lib/repo-directory", () => ({
  pickRepositoryDirectory: pickRepositoryDirectoryMock,
}));

mock.module("@/state", () => ({
  useWorkspaceState: () => ({
    activeRepo: null,
    workspaces: [],
    addWorkspace: addWorkspaceMock,
    selectWorkspace: selectWorkspaceMock,
    isSwitchingWorkspace: false,
  }),
}));

mock.module("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("button", { type: "button", ...props }, children),
}));

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogBody: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogDescription: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("p", props, children),
  DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("h2", props, children),
}));

describe("OpenRepositoryModal", () => {
  let OpenRepositoryModal: typeof import("./open-repository-modal").OpenRepositoryModal;

  beforeAll(async () => {
    ({ OpenRepositoryModal } = await import("./open-repository-modal"));
  });

  test("renders string host errors from repository add failures", async () => {
    pickRepositoryDirectoryMock.mockImplementation(async () => "/repo");
    addWorkspaceMock.mockImplementation(async () => {
      throw "bd not found in PATH";
    });

    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(OpenRepositoryModal, {
          open: true,
          canClose: false,
          onOpenChange: () => {},
        }),
      );
      await flush();
    });

    const primaryButton = renderer.root.findAllByType("button")[0];
    if (!primaryButton) {
      throw new Error("Primary button not found");
    }

    await act(async () => {
      primaryButton.props.onClick();
      await flush();
    });

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain("bd not found in PATH");
  });
});
