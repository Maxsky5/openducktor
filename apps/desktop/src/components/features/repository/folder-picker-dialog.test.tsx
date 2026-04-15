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
  currentPathIsGitRepo: false,
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
    requireGitRepo?: boolean;
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
        expect((screen.getByLabelText("Filter directories") as HTMLInputElement).value).toBe("");
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
            currentPathIsGitRepo: true,
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
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe("");

      fireEvent.click(screen.getByRole("button", { name: /go to parent folder/i }));
      await screen.findByText("/Users/dev");
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe("");

      fireEvent.click(screen.getByRole("button", { name: /go to home folder/i }));
      await screen.findByText("/Users/home");
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe("");

      fireEvent.change(screen.getByLabelText("Open path"), {
        target: { value: "/Users/dev/repo-one" },
      });
      fireEvent.click(screen.getByRole("button", { name: /load path/i }));

      await screen.findByText("/Users/dev/repo-one");
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe(
        "/Users/dev/repo-one",
      );

      fireEvent.click(screen.getByRole("button", { name: /go to parent folder/i }));
      await screen.findByText("/Users/dev");
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe(
        "/Users/dev/repo-one",
      );

      fireEvent.click(screen.getByRole("button", { name: /select folder/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("/Users/dev");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("disables confirmation until the current folder is a git repository when required", async () => {
    filesystemListDirectoryMock.mockImplementation(async (path?: string) => {
      if (path === "/Users/dev/repo-one") {
        return createListing({
          currentPath: "/Users/dev/repo-one",
          currentPathIsGitRepo: true,
          entries: [],
        });
      }

      return createListing({
        currentPath: "/Users/dev",
        currentPathIsGitRepo: false,
        entries: [
          {
            name: "repo-one",
            path: "/Users/dev/repo-one",
            isDirectory: true,
            isGitRepo: true,
          },
        ],
      });
    });

    const rendered = render(
      <QueryProvider useIsolatedClient>
        <FolderPickerDialog
          open
          onOpenChange={() => {}}
          title="Pick a folder"
          description="Browse the filesystem"
          confirmLabel="Open Repository"
          requireGitRepo
          onConfirm={async () => {}}
        />
      </QueryProvider>,
    );

    try {
      await screen.findByText(/only git repositories can be opened/i);
      const confirmButton = screen.getByRole("button", { name: /open repository/i });
      expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

      const explorerWarning = screen.getByText(/only git repositories can be opened/i);
      const repoButton = screen.getByRole("button", { name: /repo-one/i });
      expect(repoButton.compareDocumentPosition(explorerWarning)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      fireEvent.click(repoButton);

      await waitFor(() => {
        expect(screen.getByText("/Users/dev/repo-one")).toBeTruthy();
        expect(
          (screen.getByRole("button", { name: /open repository/i }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });
    } finally {
      rendered.unmount();
    }
  });

  test("shows actionable errors for invalid manual paths and disables confirmation until a new path resolves", async () => {
    filesystemListDirectoryMock.mockImplementation(async (path?: string) => {
      if (path === "/missing") {
        throw new Error("Directory does not exist: /missing");
      }

      return createListing();
    });

    const onConfirm = mock(async (_path: string) => {});
    const rendered = renderDialog({ onConfirm });

    try {
      await screen.findByText("/Users/dev");
      expect((screen.getByLabelText("Open path") as HTMLInputElement).value).toBe("");
      expect(
        (screen.getByRole("button", { name: /select folder/i }) as HTMLButtonElement).disabled,
      ).toBe(false);

      fireEvent.change(screen.getByLabelText("Open path"), {
        target: { value: "/missing" },
      });
      fireEvent.click(screen.getByRole("button", { name: /load path/i }));

      await screen.findByText("Directory does not exist: /missing");
      expect(screen.getByText("/Users/dev")).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: /select folder/i }) as HTMLButtonElement).disabled,
      ).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: /select folder/i }));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  test("keeps the dialog locked open while confirmation is in flight", async () => {
    let resolveConfirm: (() => void) | undefined;
    const onConfirm = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onOpenChange = mock((_open: boolean) => {});

    const rendered = render(
      <QueryProvider useIsolatedClient>
        <FolderPickerDialog
          open
          onOpenChange={onOpenChange}
          title="Pick a folder"
          description="Browse the filesystem"
          confirmLabel="Select Folder"
          onConfirm={onConfirm}
        />
      </QueryProvider>,
    );

    try {
      await screen.findByText("/Users/dev");

      fireEvent.click(screen.getByRole("button", { name: /select folder/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("/Users/dev");
        expect(
          (screen.getByRole("button", { name: /cancel/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onOpenChange).not.toHaveBeenCalled();

      if (!resolveConfirm) {
        throw new Error("resolveConfirm was not assigned");
      }
      resolveConfirm();

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    } finally {
      rendered.unmount();
    }
  });
});
