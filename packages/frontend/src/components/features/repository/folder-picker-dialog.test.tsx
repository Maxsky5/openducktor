import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
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

// TanStack Query sends query updates on the next task.
const flushQueryResult = async (result: Promise<unknown>): Promise<void> => {
  await act(async () => {
    await result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

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
        createElement("div", { ...props, "data-slot": "scroll-area" }, children ?? null),
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

  test("fills the available height to keep directory navigation stable", () => {
    const rendered = renderDialog();

    try {
      const dialog = screen.getByRole("dialog");
      expect(dialog.classList.contains("h-[calc(100dvh-2rem)]")).toBe(true);

      const tree = dialog.querySelector('[data-slot="folder-picker-directory-tree"]');
      expect(tree?.classList.contains("min-h-0")).toBe(true);
      expect(tree?.classList.contains("flex-1")).toBe(true);

      const directoryScroll = dialog.querySelector('[data-slot="folder-picker-directory-scroll"]');
      expect(directoryScroll?.classList.contains("absolute")).toBe(true);
      expect(directoryScroll?.classList.contains("inset-0")).toBe(true);

      const directoryList = dialog.querySelector('[data-slot="scroll-area"]');
      expect(directoryList?.classList.contains("size-full")).toBe(true);

      const feedback = dialog.querySelector('[data-slot="folder-picker-feedback"]');
      expect(feedback?.classList.contains("min-h-[2.625rem]")).toBe(true);
    } finally {
      rendered.unmount();
    }
  });

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

      expect(screen.queryByRole("button", { name: "old-cli" })).toBeNull();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Select Folder" }).disabled,
      ).toBe(true);

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

      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      await waitFor(() => {
        expect(requestCount).toBe(2);
        expect(confirmButton.disabled).toBe(true);
      });
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();

      resolveRefresh(createListing());
      await flushQueryResult(refreshListing);

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

  test("removes previous entries without remounting or shrinking the directory tree", async () => {
    let resolveNext = (_listing: DirectoryListing): void => undefined;
    const nextListing = new Promise<DirectoryListing>((resolve) => {
      resolveNext = resolve;
    });
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
      if (path === "/Users/dev/next") return nextListing;
      return createListing({
        entries: [
          {
            name: "old-entry",
            path: "/Users/dev/old-entry",
            isDirectory: true,
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
    const rendered = renderDialog({ initialPath: "/Users/dev" });

    try {
      const nextButton = await screen.findByRole("button", { name: "next" });
      const manualPath = screen.getByLabelText<HTMLInputElement>("Open path");
      const filter = screen.getByLabelText<HTMLInputElement>("Filter directories");
      const parent = screen.getByRole<HTMLButtonElement>("button", {
        name: "Go to parent folder",
      });
      const home = screen.getByRole<HTMLButtonElement>("button", { name: "Go to home folder" });
      const tree = document.querySelector<HTMLElement>(
        '[data-slot="folder-picker-directory-tree"]',
      );
      if (!tree) throw new Error("Missing directory tree");
      expect(tree.classList.contains("min-h-0")).toBe(true);
      expect(tree.classList.contains("flex-1")).toBe(true);
      jest.useFakeTimers();
      fireEvent.click(nextButton);

      expect(screen.getByText("/Users/dev/next")).toBeTruthy();
      expect(screen.queryByText("Loading directories…")).toBeNull();
      act(() => jest.advanceTimersByTime(499));
      expect(screen.queryByText("Loading directories…")).toBeNull();
      act(() => jest.advanceTimersByTime(1));
      expect(screen.getByText("Loading directories…")).toBeTruthy();
      expect(document.querySelector('[data-slot="folder-picker-directory-tree"]')).toBe(tree);
      expect(tree.getAttribute("aria-busy")).toBe("true");
      const loading = document.querySelector<HTMLElement>(
        '[data-slot="folder-picker-directory-loading"]',
      );
      if (!loading) throw new Error("Missing directory loading layer");
      expect(loading.classList.contains("absolute")).toBe(true);
      expect(loading.classList.contains("inset-0")).toBe(true);
      expect(screen.queryByRole("button", { name: "old-entry" })).toBeNull();
      expect(screen.queryByRole("button", { name: "next" })).toBeNull();
      expect(screen.getByLabelText("Open path")).toBe(manualPath);
      expect(screen.getByLabelText("Filter directories")).toBe(filter);
      expect(manualPath.disabled).toBe(false);
      expect(filter.disabled).toBe(false);
      expect(parent.disabled).toBe(false);
      expect(parent.getAttribute("aria-disabled")).toBe("true");
      expect(home.disabled).toBe(false);
      expect(home.getAttribute("aria-disabled")).toBe("true");

      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Select Folder",
      });
      expect(confirmButton.disabled).toBe(true);

      await act(async () => {
        resolveNext(
          createListing({
            currentPath: "/Users/dev/next",
            parentPath: "/Users/dev",
            entries: [
              {
                name: "new-entry",
                path: "/Users/dev/next/new-entry",
                isDirectory: true,
                isGitRepo: false,
              },
            ],
          }),
        );
      });
      expect(await screen.findByRole("button", { name: "new-entry" })).toBeTruthy();
      expect(document.querySelector('[data-slot="folder-picker-directory-tree"]')).toBe(tree);
      expect(tree.getAttribute("aria-busy")).toBe("false");
    } finally {
      jest.useRealTimers();
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
            entries: [
              {
                name: "cached-entry",
                path: "/Users/dev/cached-entry",
                isDirectory: true,
                isGitRepo: false,
              },
            ],
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
            entries: [
              {
                name: "repo-entry",
                path: "/Users/dev/repo-one/repo-entry",
                isDirectory: true,
                isGitRepo: false,
              },
            ],
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
      expect(screen.getByRole("button", { name: "cached-entry" })).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "repo-entry" })).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>("Open path").value).toBe(
        "/Users/dev/repo-one",
      );

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: /go to parent folder/i }),
      );

      expect(screen.getByText("/Users/dev")).toBeTruthy();
      expect(screen.getByRole("button", { name: "cached-entry" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "repo-entry" })).toBeNull();
      expect(screen.queryByText("Loading directories…")).toBeNull();
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
    let missingLoads = 0;
    let resolveRetry = (_listing: DirectoryListing): void => undefined;
    const retryListing = new Promise<DirectoryListing>((resolve) => {
      resolveRetry = resolve;
    });
    filesystemListDirectoryMock.mockImplementation(async (input?: ListDirectoryInput) => {
      const path = pathFromInput(input);
      if (path === "/missing") {
        missingLoads += 1;
        if (missingLoads === 1) {
          throw new Error("Directory does not exist: /missing");
        }
        return retryListing;
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
      expect(screen.getByText("/missing")).toBeTruthy();
      expect(screen.queryByText("/Users/dev")).toBeNull();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }).disabled,
      ).toBe(true);

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }));
      expect(onConfirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /load path/i }));

      await waitFor(() => {
        expect(missingLoads).toBe(2);
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: /select folder/i }).disabled,
        ).toBe(true);
        expect(screen.getByText("/missing")).toBeTruthy();
        expect(screen.getByText("Loading directories…")).toBeTruthy();
      });

      resolveRetry(createListing({ currentPath: "/missing" }));
      await flushQueryResult(retryListing);

      await waitFor(() => {
        expect(screen.queryByText("Loading directories…")).toBeNull();
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
