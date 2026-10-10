import { describe, expect, test } from "bun:test";
import {
  settingsSnapshotSchema,
  type SystemOpenInToolId,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { WorkspaceSessionHistoryDialog } from "./workspace-session-history-dialog";
import { WorkspaceSessionHeader } from "./workspace-session-header";
import { WorkspaceSessionRenameDialog } from "./workspace-session-rename-dialog";

const record = (): WorkspaceSession => ({
  id: "session-1",
  runtimeKind: "codex",
  externalSessionId: "native-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: { id: "role", name: "Reviewer", systemPrompt: "Review the code." },
  selectedModel: null,
  generatedTitle: "Generated title",
  manualTitle: "My session",
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

describe("Workspace Session metadata UI", () => {
  test.each([
    ["local_repo_root", "Reviewer"],
    ["local_worktree", null],
  ] as const)(
    "the top bar exposes metadata in tooltips and copies and opens the %s directory",
    async (kind, roleName) => {
      const opened: Array<[string, SystemOpenInToolId]> = [];
      const copied: string[] = [];
      const restoreClipboard = replaceNavigatorClipboard(async (value) => {
        copied.push(value);
      });
      const session: WorkspaceSession = {
        ...record(),
        roleSnapshot: roleName ? record().roleSnapshot : null,
        executionTarget:
          kind === "local_repo_root"
            ? { kind, workingDirectory: "/old/repo" }
            : {
                kind,
                workingDirectory: "/repo/worktrees/chat",
                branchName: "chat",
                worktreeState: "present",
              },
      };
      configureShellBridge(
        createShellBridgeFixture({
          client: {
            workspaceGetSettingsSnapshot: async () =>
              settingsSnapshotSchema.parse({ theme: "light" }),
            systemListOpenInTools: async () => [
              { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
            ],
            systemOpenDirectoryInTool: async (path, toolId) => {
              opened.push([path, toolId]);
            },
          },
        }),
      );
      const view = render(
        <QueryProvider useIsolatedClient>
          <WorkspaceSessionHeader
            workspace={{ workspaceId: "A", workspaceName: "Workspace", repoPath: "/repo" }}
            record={session}
            repoActions={null}
            viewControls={null}
            onArchive={() => {}}
            isArchiving={false}
          />
        </QueryProvider>,
      );
      try {
        const target = kind === "local_repo_root" ? "repository root" : "workspace worktree";
        const open = await view.findByRole(
          "button",
          { name: `Open ${target} in Finder` },
          { timeout: 800 },
        );
        await waitFor(() => expect(open.hasAttribute("disabled")).toBe(false), { timeout: 800 });
        expect(open.closest("header")).toBe(
          view.getByRole("heading", { name: "My session" }).closest("header"),
        );
        const directory = session.executionTarget.workingDirectory;
        expect(open.closest("header")?.textContent).not.toContain(directory);
        expect(open.closest("header")?.textContent).not.toContain("Reviewer");
        const role = view.queryByRole("img", { name: "Custom role" });
        if (roleName) {
          expect(role).toBeTruthy();
          fireEvent.focus(role!);
          expect((await view.findByRole("tooltip")).textContent).toBe(roleName);
          fireEvent.blur(role!);
        } else {
          expect(role).toBeNull();
        }
        const copy = view.getByRole("button", { name: "Copy working directory" });
        fireEvent.focus(copy);
        await waitFor(() => expect(view.getByRole("tooltip").textContent).toContain(directory));
        if (roleName) {
          // Happy DOM has no layout. These boxes put the role inside the path tooltip's pointer travel area.
          const trigger = copy.parentElement!;
          const content = view
            .getByRole("tooltip")
            .closest<HTMLElement>('[data-slot="tooltip-content"]')!;
          trigger.getBoundingClientRect = () => new DOMRect(332, 0, 28, 28);
          content.getBoundingClientRect = () => new DOMRect(154, 28, 384, 48);
          fireEvent.pointerLeave(trigger, { pointerType: "mouse", clientX: 332, clientY: 14 });
          fireEvent.pointerMove(role!, { pointerType: "mouse", clientX: 314, clientY: 14 });
          await waitFor(() => expect(view.getByRole("tooltip").textContent).toBe(roleName), {
            timeout: 500,
          });
          fireEvent.blur(role!);
          fireEvent.focus(copy);
        }
        await act(async () => {
          fireEvent.click(copy);
        });
        expect(copied).toEqual([directory]);
        fireEvent.blur(copy);
        fireEvent.focus(copy);
        await waitFor(() => expect(view.getByRole("tooltip").textContent).toContain("Copied"));
        expect(view.getByRole("tooltip").textContent).toContain(directory);
        fireEvent.click(open);
        await waitFor(() => expect(opened).toEqual([[directory, "finder"]]), { timeout: 800 });
      } finally {
        view.unmount();
        restoreClipboard();
        configureShellBridge(createUnavailableShellBridge());
      }
    },
  );

  test("rename separates the header, body, and footer with Cancel on the left", () => {
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionRenameDialog
          open
          workspaceId="A"
          record={record()}
          onClose={() => {}}
          onCloseAutoFocus={() => {}}
        />
      </QueryProvider>,
    );
    try {
      const dialog = view.getByRole("dialog", { name: "Rename chat" });
      const header = view.getByRole("heading", { name: "Rename chat" }).parentElement;
      const body = view.getByRole("textbox", { name: "Name" }).parentElement;
      const cancel = view.getByRole("button", { name: "Cancel" });
      const save = view.getByRole("button", { name: "Save" });
      const footer = cancel.parentElement;

      expect(dialog.classList.contains("p-0")).toBe(true);
      expect(header?.classList.contains("border-b")).toBe(true);
      expect(body?.classList.contains("px-5")).toBe(true);
      expect(body?.classList.contains("py-4")).toBe(true);
      expect(footer?.classList.contains("border-t")).toBe(true);
      expect(footer?.classList.contains("mt-0")).toBe(true);
      expect(footer?.classList.contains("justify-between")).toBe(true);
      expect(footer?.firstElementChild).toBe(cancel);
      expect(footer?.lastElementChild).toBe(save);
      expect(dialog.querySelector("form")?.classList.contains("min-h-0")).toBe(true);
      expect(cancel.closest("fieldset")?.classList.contains("min-h-0")).toBe(true);
    } finally {
      view.unmount();
    }
  });

  test("Cancel discards a rename without saving and returns focus to session actions", async () => {
    const saved: string[] = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionRename: async (input) => {
            saved.push(input.manualTitle ?? "");
            return { ...record(), manualTitle: input.manualTitle };
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHeader
          repoActions={null}
          viewControls={null}
          onArchive={() => {}}
          isArchiving={false}
          workspace={{ workspaceId: "A", workspaceName: "Workspace", repoPath: "/repo" }}
          record={record()}
        />
      </QueryProvider>,
    );
    try {
      const heading = view.getByRole("heading", { name: "My session" });
      fireEvent.click(heading);
      expect(view.queryByRole("textbox")).toBeNull();
      const actions = view.getByRole("button", { name: "Session actions" });
      fireEvent.click(actions);
      fireEvent.click(await view.findByRole("button", { name: "Rename" }, { timeout: 800 }));
      const title = await view.findByRole("textbox", { name: "Name" }, { timeout: 800 });
      await waitFor(() => expect(document.activeElement === title).toBe(true), { timeout: 800 });
      fireEvent.change(title, { target: { value: "Discard this" } });
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(document.activeElement === actions).toBe(true), { timeout: 800 });
      expect(saved).toEqual([]);
      fireEvent.click(actions);
      fireEvent.click(await view.findByRole("button", { name: "Rename" }, { timeout: 800 }));
      expect(await view.findByDisplayValue("My session", {}, { timeout: 800 })).toBeTruthy();
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("rename locks the form until Save completes and supports the generated title", async () => {
    const saved: string[] = [];
    let finish!: (session: WorkspaceSession) => void;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionRename: (input) => {
            saved.push(input.manualTitle ?? "");
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHeader
          repoActions={null}
          viewControls={null}
          onArchive={() => {}}
          isArchiving={false}
          workspace={{ workspaceId: "A", workspaceName: "Workspace", repoPath: "/repo" }}
          record={record()}
        />
      </QueryProvider>,
    );
    try {
      fireEvent.click(view.getByRole("button", { name: "Session actions" }));
      fireEvent.click(await view.findByRole("button", { name: "Rename" }, { timeout: 800 }));
      const title = await view.findByRole("textbox", { name: "Name" }, { timeout: 800 });
      fireEvent.change(title, { target: { value: "" } });
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Save" }));
      });
      expect(saved).toEqual([""]);
      const saving = await view.findByRole("button", { name: "Saving…" }, { timeout: 800 });
      expect(saving.hasAttribute("disabled")).toBe(true);
      expect(title.closest("fieldset")?.disabled).toBe(true);
      expect(view.getByRole("button", { name: "Cancel" }).closest("fieldset")?.disabled).toBe(true);
      fireEvent.click(saving);
      fireEvent.keyDown(title, { key: "Escape" });
      expect(view.getByRole("dialog", { name: "Rename chat" })).toBeTruthy();
      expect(saved).toEqual([""]);
      await act(async () => {
        finish({ ...record(), manualTitle: null });
      });
      await waitFor(() => expect(view.queryByRole("dialog", { name: "Rename chat" })).toBeNull(), {
        timeout: 800,
      });
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("History filters titles, roles, and paths without refetching and restores the filtered chat", async () => {
    let reads = 0;
    const restored: string[] = [];
    const first = { ...record(), archivedAt: 2000 };
    const second: WorkspaceSession = {
      ...record(),
      id: "session-2",
      manualTitle: "Build API",
      roleSnapshot: null,
      executionTarget: { kind: "local_repo_root", workingDirectory: "/other/project" },
      archivedAt: 3000,
    };
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListArchived: async () => {
            reads += 1;
            return restored.includes(second.id) ? [first] : [first, second];
          },
          workspaceSessionRestore: async (input) => {
            restored.push(input.sessionId);
            return { ...second, archivedAt: null };
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHistoryDialog
          workspaceId="filter-test"
          repoPath="/repo"
          onClose={() => {}}
        />
      </QueryProvider>,
    );
    try {
      await view.findByRole("button", { name: "Restore Build API" }, { timeout: 800 });
      const filter = view.getByRole("searchbox", { name: "Filter archived chats" });
      fireEvent.change(filter, { target: { value: "  BUILD  " } });
      expect(view.queryByRole("button", { name: "Restore My session" })).toBeNull();
      expect(view.getByRole("button", { name: "Restore Build API" })).toBeTruthy();
      fireEvent.change(filter, { target: { value: "reviewer" } });
      expect(view.getByRole("button", { name: "Restore My session" })).toBeTruthy();
      expect(view.queryByRole("button", { name: "Restore Build API" })).toBeNull();
      fireEvent.change(filter, { target: { value: "unmatched" } });
      expect(view.getByText("No chats match your filter.")).toBeTruthy();
      fireEvent.change(filter, { target: { value: "" } });
      expect(view.getByRole("button", { name: "Restore My session" })).toBeTruthy();
      fireEvent.change(filter, { target: { value: "/OTHER" } });
      expect(reads).toBe(1);
      fireEvent.click(view.getByRole("button", { name: "Restore Build API" }));
      await view.findByText("No chats match your filter.", {}, { timeout: 800 });
      expect(restored).toEqual(["session-2"]);
      expect(reads).toBe(2);
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });
  test("History is restore-only and disables restoration while the command is pending", async () => {
    const archived = { ...record(), archivedAt: 2000 };
    let archivedRecords = [archived];
    const requests: Array<{ workspaceId: string; sessionId: string }> = [];
    let finish!: (session: WorkspaceSession) => void;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListArchived: async () => archivedRecords,
          workspaceSessionRestore: (input) => {
            requests.push(input);
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHistoryDialog workspaceId="A" repoPath="/repo" onClose={() => {}} />
      </QueryProvider>,
    );
    try {
      const restore = await view.findByRole(
        "button",
        { name: "Restore My session" },
        { timeout: 800 },
      );
      expect(view.getByRole("searchbox", { name: "Filter archived chats" })).toBeTruthy();
      expect(view.queryByRole("link")).toBeNull();
      await act(async () => {
        fireEvent.click(restore);
      });
      await waitFor(() => expect(restore.hasAttribute("disabled")).toBe(true), { timeout: 800 });
      expect(requests).toEqual([{ workspaceId: "A", sessionId: "session-1" }]);
      await act(async () => {
        archivedRecords = [];
        finish(record());
      });
      await view.findByText("No archived sessions.", {}, { timeout: 800 });
      expect(view.getByRole("searchbox", { name: "Filter archived chats" })).toBeTruthy();
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("History keeps the archived row and reports a failed restore", async () => {
    let reads = 0;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListArchived: async () => {
            reads += 1;
            return [{ ...record(), archivedAt: 2000 }];
          },
          workspaceSessionRestore: async () => {
            throw new Error("Worktree directory is missing.");
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHistoryDialog workspaceId="A" repoPath="/repo" onClose={() => {}} />
      </QueryProvider>,
    );
    try {
      fireEvent.click(
        await view.findByRole("button", { name: "Restore My session" }, { timeout: 800 }),
      );
      await view.findByText("Worktree directory is missing.", {}, { timeout: 800 });
      expect(reads).toBe(1);
      expect(
        view.getByRole("button", { name: "Restore My session" }).hasAttribute("disabled"),
      ).toBe(false);
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("a failed rename retains the draft and permits a second save", async () => {
    const saved: string[] = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionRename: async (input) => {
            saved.push(input.manualTitle ?? "");
            if (saved.length === 1) throw new Error("Database unavailable");
            return { ...record(), manualTitle: input.manualTitle };
          },
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionHeader
          repoActions={null}
          viewControls={null}
          onArchive={() => {}}
          isArchiving={false}
          workspace={{ workspaceId: "A", workspaceName: "Workspace", repoPath: "/repo" }}
          record={record()}
        />
      </QueryProvider>,
    );
    try {
      expect(view.queryByRole("textbox", { name: "Session title" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Session actions" }));
      fireEvent.click(await view.findByRole("button", { name: "Rename" }, { timeout: 800 }));
      expect(
        await view.findByRole("dialog", { name: "Rename chat" }, { timeout: 800 }),
      ).toBeTruthy();
      const title = view.getByRole("textbox", { name: "Name" });
      fireEvent.change(title, { target: { value: "Updated name" } });
      fireEvent.blur(title);
      expect(saved).toEqual([]);
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await view.findByText("Database unavailable", {}, { timeout: 800 });
      if (!(title instanceof HTMLInputElement)) throw new Error("Expected the title input.");
      expect(title.value).toBe("Updated name");
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(saved).toEqual(["Updated name", "Updated name"]), {
        timeout: 800,
      });
      await waitFor(() => expect(view.queryByText("Database unavailable")).toBeNull(), {
        timeout: 800,
      });
      expect(view.queryByRole("dialog", { name: "Rename chat" })).toBeNull();
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });
});
