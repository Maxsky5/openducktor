import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DirectoryListing } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const omitDialogDomProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const {
    closeButton: _closeButton,
    onEscapeKeyDown: _onEscapeKeyDown,
    onPointerDownOutside: _onPointerDownOutside,
    onOpenChange: _onOpenChange,
    ...domProps
  } = props;

  return domProps;
};

const createListing = (overrides: Partial<DirectoryListing> = {}): DirectoryListing => ({
  currentPath: "/Users/dev",
  parentPath: "/Users",
  homePath: "/Users/dev",
  entries: [],
  ...overrides,
});

const filesystemListDirectoryMock = mock(
  async (_path?: string): Promise<DirectoryListing> => createListing(),
);

describe("FolderPickerDialog", () => {
  let FolderPickerDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel: string;
    initialPath?: string;
    onConfirm: (path: string) => Promise<void>;
  }) => ReactNode;

  beforeEach(async () => {
    filesystemListDirectoryMock.mockReset();
    filesystemListDirectoryMock.mockImplementation(async (_path?: string) => createListing());

    mock.module("@/state/operations/host", () => ({
      host: {
        filesystemListDirectory: filesystemListDirectoryMock,
      },
    }));

    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogBody: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogDescription: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => createElement("p", omitDialogDomProps(props), children),
      DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("h2", omitDialogDomProps(props), children),
    }));

    mock.module("@/components/ui/scroll-area", () => ({
      ScrollArea: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", props, children),
    }));

    ({ FolderPickerDialog } = await import("./folder-picker-dialog"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/operations/host", () => import("@/state/operations/host")],
      ["@/components/ui/dialog", () => import("@/components/ui/dialog")],
      ["@/components/ui/scroll-area", () => import("@/components/ui/scroll-area")],
    ]);
  });

  const renderDialog = (
    props?: Partial<{
      onConfirm: (path: string) => Promise<void>;
      initialPath: string;
    }>,
  ) => {
    return render(
      <QueryProvider useIsolatedClient>
        <FolderPickerDialog
          open
          onOpenChange={() => {}}
          title="Pick a folder"
          description="Browse the filesystem"
          confirmLabel="Select Folder"
          onConfirm={props?.onConfirm ?? (async () => {})}
          {...(props?.initialPath ? { initialPath: props.initialPath } : {})}
        />
      </QueryProvider>,
    );
  };

  test("loads directories, filters entries, and navigates into a child directory", async () => {
    filesystemListDirectoryMock.mockImplementation(async (path?: string) => {
      if (path === "/Users/dev/apps") {
        return createListing({
          currentPath: "/Users/dev/apps",
          parentPath: "/Users/dev",
          homePath: "/Users/dev",
          entries: [],
        });
      }

      return createListing({
        currentPath: "/Users/dev",
        parentPath: "/Users",
        homePath: "/Users/dev",
        entries: [
          {
            name: "apps",
            path: "/Users/dev/apps",
            isDirectory: true,
            isGitRepo: false,
          },
          {
            name: "repo-one",
            path: "/Users/dev/repo-one",
            isDirectory: true,
            isGitRepo: true,
          },
        ],
      });
    });

    const rendered = renderDialog();

    try {
      await screen.findByText("repo-one");
      expect(screen.getByText("Git repo")).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Filter directories"), {
        target: { value: "repo" },
      });

      await waitFor(() => {
        expect(screen.queryByText("apps")).toBeNull();
      });

      fireEvent.change(screen.getByLabelText("Filter directories"), {
        target: { value: "" },
      });

      fireEvent.click(screen.getByRole("button", { name: /^apps$/i }));

      await waitFor(() => {
        expect(screen.getByText("/Users/dev/apps")).toBeTruthy();
      });
    } finally {
      rendered.unmount();
    }
  });

  test("supports parent and home navigation, manual path loading, and current-path confirmation", async () => {
    const onConfirm = mock(async (_path: string) => {});

    filesystemListDirectoryMock.mockImplementation(async (path?: string) => {
      switch (path) {
        case "/Users/dev/projects":
          return createListing({
            currentPath: "/Users/dev/projects",
            parentPath: "/Users/dev",
            homePath: "/Users/home",
            entries: [],
          });
        case "/Users/dev":
          return createListing({
            currentPath: "/Users/dev",
            parentPath: "/Users",
            homePath: "/Users/home",
            entries: [],
          });
        case "/Users/home":
          return createListing({
            currentPath: "/Users/home",
            parentPath: "/Users",
            homePath: "/Users/home",
            entries: [],
          });
        case "/Users/dev/repo-one":
          return createListing({
            currentPath: "/Users/dev/repo-one",
            parentPath: "/Users/dev",
            homePath: "/Users/home",
            entries: [],
          });
        default:
          throw new Error(`Unexpected path: ${String(path)}`);
      }
    });

    const rendered = renderDialog({ onConfirm, initialPath: "/Users/dev/projects" });

    try {
      await screen.findByText("/Users/dev/projects");

      fireEvent.click(screen.getByRole("button", { name: /parent/i }));
      await screen.findByText("/Users/dev");

      fireEvent.click(screen.getByRole("button", { name: /home/i }));
      await screen.findByText("/Users/home");

      fireEvent.change(screen.getByLabelText("Open path"), {
        target: { value: "/Users/dev/repo-one" },
      });
      fireEvent.click(screen.getByRole("button", { name: /load path/i }));

      await screen.findByText("/Users/dev/repo-one");

      fireEvent.click(screen.getByRole("button", { name: /select folder/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("/Users/dev/repo-one");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("shows actionable errors for invalid manual paths without losing the last resolved folder", async () => {
    filesystemListDirectoryMock.mockImplementation(async (path?: string) => {
      if (path === "/missing") {
        throw new Error("Directory does not exist: /missing");
      }

      return createListing();
    });

    const rendered = renderDialog();

    try {
      await screen.findByText("/Users/dev");

      fireEvent.change(screen.getByLabelText("Open path"), {
        target: { value: "/missing" },
      });
      fireEvent.click(screen.getByRole("button", { name: /load path/i }));

      await screen.findByText("Directory does not exist: /missing");
      expect(screen.getByText("/Users/dev")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });
});
