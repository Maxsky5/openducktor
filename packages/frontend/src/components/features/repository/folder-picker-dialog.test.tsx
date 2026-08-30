import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { DirectoryListing, FilesystemListDirectoryInput } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { z } from "zod";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";

const actualScrollAreaModule = await import("@/components/ui/scroll-area");
let scrollAreaSpy: { mockRestore(): void };

enableReactActEnvironment();

const createListing = (overrides: Partial<DirectoryListing> = {}): DirectoryListing => ({
  currentPath: "/Users/dev",
  currentPathIsGitRepo: false,
  parentPath: "/Users",
  homePath: "/Users/dev",
  entries: [],
  ...overrides,
});

type ListDirectoryInput = string | FilesystemListDirectoryInput | undefined;
const pathFromInput = (input: ListDirectoryInput): string | undefined => {
  const stringInput = z.string().safeParse(input);
  if (stringInput.success) {
    return stringInput.data;
  }
  const objectInput = z.object({ path: z.string().optional() }).safeParse(input);
  return objectInput.success ? objectInput.data.path : undefined;
};
const filesystemListDirectoryMock = mock(
  async (_input?: ListDirectoryInput): Promise<DirectoryListing> => createListing(),
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
    selectionMode?: "directory" | "file";
    onConfirm: (path: string) => Promise<void>;
  }) => ReactNode;

  beforeEach(async () => {
    filesystemListDirectoryMock.mockReset();
    filesystemListDirectoryMock.mockImplementation(async (_input?: ListDirectoryInput) =>
      createListing(),
    );

    configureShellBridge(
      createShellBridgeFixture({
        client: { filesystemListDirectory: filesystemListDirectoryMock },
      }),
    );
    scrollAreaSpy = spyOn(actualScrollAreaModule, "ScrollArea").mockImplementation(
      ({ children, ...props }: Parameters<typeof actualScrollAreaModule.ScrollArea>[0]) =>
        createElement("div", props, children ?? null),
    );

    ({ FolderPickerDialog } = await import("./folder-picker-dialog"));
  });

  afterEach(() => {
    scrollAreaSpy.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  });

  const renderDialog = (
    props?: Partial<{
      onConfirm: (path: string) => Promise<void>;
      initialPath: string;
      selectionMode: "directory" | "file";
    }>,
  ) => {
    const dialogProps: Parameters<typeof FolderPickerDialog>[0] = {
      open: true,
      onOpenChange: () => {},
      title: "Pick a folder",
      description: "Browse the filesystem",
      confirmLabel: "Select Folder",
      onConfirm: props?.onConfirm ?? (async () => {}),
      selectionMode: props?.selectionMode ?? "directory",
    };
    if (props?.initialPath) {
      dialogProps.initialPath = props.initialPath;
    }
    return render(
      <QueryProvider useIsolatedClient>
        <FolderPickerDialog {...dialogProps} />
      </QueryProvider>,
    );
  };

  test("loads directories, filters entries, and navigates into a child directory", async () => {
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
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

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Filter directories"), {
        target: { value: "repo" },
      });

      await waitFor(() => {
        expect(screen.queryByText("apps")).toBeNull();
      });

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Filter directories"), {
        target: { value: "" },
      });

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /^apps$/i }));

      await waitFor(() => {
        expect(screen.getByText("/Users/dev/apps")).toBeTruthy();
        expect(screen.getByLabelText<HTMLInputElement>("Filter directories").value).toBe("");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("selects a file and requests file entries only in file mode", async () => {
    const onConfirm = mock(async (_path: string) => {});
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const objectInput = z.object({ includeFiles: z.boolean().optional() }).safeParse(input);
      expect(objectInput.success ? objectInput.data.includeFiles : false).toBe(true);
      return createListing({
        entries: [
          {
            name: "codex",
            path: "/Users/dev/codex",
            isDirectory: false,
            isGitRepo: false,
          },
        ],
      });
    });
    const rendered = renderDialog({ onConfirm, selectionMode: "file" });

    try {
      fireEvent.click(await screen.findByRole("button", { name: "codex" }));
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("/Users/dev/codex"));
    } finally {
      rendered.unmount();
    }
  });

  test("does not keep a stale file selection when a new directory resolves", async () => {
    const onConfirm = mock(async (_path: string) => {});
    let resolveNextDirectory = (_listing: DirectoryListing): void => undefined;
    const nextDirectory = new Promise<DirectoryListing>((resolve) => {
      resolveNextDirectory = resolve;
    });
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      if (pathFromInput(input) === "/Users/dev/next") {
        return nextDirectory;
      }
      return createListing({
        entries: [
          {
            name: "old-cli",
            path: "/Users/dev/old-cli",
            isDirectory: false,
            isGitRepo: false,
          },
          {
            name: "next",
            path: "/Users/dev/next",
            isDirectory: true,
            isGitRepo: false,
          },
        ],
      });
    });
    const rendered = renderDialog({ onConfirm, selectionMode: "file" });

    try {
      fireEvent.click(await screen.findByRole("button", { name: "old-cli" }));
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "next" }));
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "old-cli" }));

      await act(async () => {
        resolveNextDirectory(
          createListing({ currentPath: "/Users/dev/next", parentPath: "/Users/dev" }),
        );
      });
      await screen.findByText("/Users/dev/next");

      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  test("clears a file selection removed by a same-directory refresh", async () => {
    const onConfirm = mock(async (_path: string) => {});
    let requestCount = 0;
    let resolveRefresh = (_listing: DirectoryListing): void => undefined;
    const refreshListing = new Promise<DirectoryListing>((resolve) => {
      resolveRefresh = resolve;
    });
    filesystemListDirectoryMock.mockImplementation(async () => {
      requestCount += 1;
      if (requestCount > 1) return refreshListing;
      return createListing({
        entries: [
          {
            name: "codex",
            path: "/Users/dev/codex",
            isDirectory: false,
            isGitRepo: false,
          },
        ],
      });
    });
    const rendered = renderDialog({
      onConfirm,
      initialPath: "/Users/dev",
      selectionMode: "file",
    });

    try {
      fireEvent.click(await screen.findByRole("button", { name: "codex" }));
      expect(requestCount).toBe(1);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }).disabled,
      ).toBe(false);

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/Users/dev" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await waitFor(() => expect(requestCount).toBe(2));
      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();

      await act(async () => resolveRefresh(createListing()));

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "codex" })).toBeNull();
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }).disabled,
        ).toBe(true);
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  test("blocks directory confirmation when a same-directory refresh fails", async () => {
    const onConfirm = mock(async (_path: string) => {});
    let requestCount = 0;
    filesystemListDirectoryMock.mockImplementation(async () => {
      requestCount += 1;
      if (requestCount > 1) {
        throw new Error("Directory no longer exists: /Users/dev");
      }
      return createListing();
    });
    const rendered = renderDialog({ onConfirm, initialPath: "/Users/dev" });

    try {
      await screen.findByText("/Users/dev");
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }).disabled,
      ).toBe(false);

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/Users/dev" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await screen.findByText("Directory no longer exists: /Users/dev");
      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  test("restores file confirmation only after a failed refresh succeeds", async () => {
    const onConfirm = mock(async (_path: string) => {});
    let requestCount = 0;
    const listing = createListing({
      entries: [
        {
          name: "codex",
          path: "/Users/dev/codex",
          isDirectory: false,
          isGitRepo: false,
        },
      ],
    });
    filesystemListDirectoryMock.mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 2) {
        throw new Error("Failed to refresh /Users/dev");
      }
      return listing;
    });
    const rendered = renderDialog({
      onConfirm,
      initialPath: "/Users/dev",
      selectionMode: "file",
    });

    try {
      fireEvent.click(await screen.findByRole("button", { name: "codex" }));
      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/Users/dev" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await screen.findByText("Failed to refresh /Users/dev");
      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await waitFor(() => {
        expect(requestCount).toBe(3);
        expect(confirmButton.disabled).toBe(false);
      });
      fireEvent.click(confirmButton);
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("/Users/dev/codex"));
    } finally {
      rendered.unmount();
    }
  });

  test("does not restore a superseded directory after its refresh completes", async () => {
    const onConfirm = mock(async (_path: string) => {});
    let rootRequestCount = 0;
    let resolveRefresh = (_listing: DirectoryListing): void => undefined;
    let rejectNextDirectory = (_error: Error): void => undefined;
    const refreshListing = new Promise<DirectoryListing>((resolve) => {
      resolveRefresh = resolve;
    });
    const nextDirectory = new Promise<DirectoryListing>((_resolve, reject) => {
      rejectNextDirectory = reject;
    });
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
      if (path === "/Users/dev/next") return nextDirectory;
      if (path !== "/Users/dev") throw new Error(`Unexpected path: ${String(path)}`);

      rootRequestCount += 1;
      if (rootRequestCount > 1) return refreshListing;
      return createListing({
        entries: [
          {
            name: "next",
            path: "/Users/dev/next",
            isDirectory: true,
            isGitRepo: false,
          },
        ],
      });
    });
    const rendered = renderDialog({ onConfirm, initialPath: "/Users/dev" });

    try {
      const nextButton = await screen.findByRole("button", { name: "next" });
      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/Users/dev" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));
      await waitFor(() => expect(rootRequestCount).toBe(2));

      fireEvent.click(nextButton);
      await act(async () => rejectNextDirectory(new Error("Failed to load next directory")));
      await screen.findByText("Failed to load next directory");

      await act(async () => resolveRefresh(createListing({ currentPathIsGitRepo: true })));

      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  test("supports parent and home navigation, manual path loading, and current-path confirmation", async () => {
    const onConfirm = mock(async (_path: string) => {});

    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
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
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe("");

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: /go to parent folder/i }),
      );
      await screen.findByText("/Users/dev");
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe("");

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: /go to home folder/i }),
      );
      await screen.findByText("/Users/home");
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe("");

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/Users/dev/repo-one" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await screen.findByText("/Users/dev/repo-one");
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe(
        "/Users/dev/repo-one",
      );

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: /go to parent folder/i }),
      );
      await screen.findByText("/Users/dev");
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe(
        "/Users/dev/repo-one",
      );

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("/Users/dev");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("disables confirmation until the current folder is a git repository when required", async () => {
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
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
      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: /open repository/i,
      });
      expect(confirmButton.disabled).toBe(true);

      const explorerWarning = screen.getByText(/only git repositories can be opened/i);
      const repoButton = screen.getByRole<HTMLButtonElement>("button", { name: /repo-one/i });
      expect(repoButton.compareDocumentPosition(explorerWarning)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      fireEvent.click(repoButton);

      await waitFor(() => {
        expect(screen.getByText("/Users/dev/repo-one")).toBeTruthy();
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: /open repository/i }).disabled,
        ).toBe(false);
      });
    } finally {
      rendered.unmount();
    }
  });

  test("retries the same manual path after an error and restores confirmation when it resolves", async () => {
    let missingPathAttempts = 0;
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
      if (path === "/missing") {
        missingPathAttempts += 1;
        if (missingPathAttempts === 1) {
          throw new Error("Directory does not exist: /missing");
        }
        return createListing({ currentPath: "/missing" });
      }

      return createListing();
    });

    const onConfirm = mock(async (_path: string) => {});
    const rendered = renderDialog({ onConfirm });

    try {
      await screen.findByText("/Users/dev");
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe("");
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }).disabled,
      ).toBe(false);

      fireEvent.change(screen.getByLabelText<HTMLInputElement>("Open path"), {
        target: { value: "/missing" },
      });
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await screen.findByText("Directory does not exist: /missing");
      expect(screen.getByText("/Users/dev")).toBeTruthy();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }).disabled,
      ).toBe(true);

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }));
      expect(onConfirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await waitFor(() => {
        expect(missingPathAttempts).toBe(2);
        expect(screen.getByText("/missing")).toBeTruthy();
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }).disabled,
        ).toBe(false);
      });
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

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("/Users/dev");
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /cancel/i }).disabled).toBe(
          true,
        );
        expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
      });

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /cancel/i }));
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
