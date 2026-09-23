import { expect, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";

const record = (): WorkspaceSession => ({
  id: "chat",
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/worktrees/chat",
    branchName: "feature/chat",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Worktree chat",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

test.each([false, true])(
  "removal stays enabled by default after the worktree check, dirty=%s",
  async (dirty) => {
    const requests: boolean[] = [];
    let finish!: (preview: WorkspaceSessionArchivePreview) => void;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionArchivePreview: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        },
      }),
    );
    const view = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionArchiveDialog
          workspaceId="test"
          record={record()}
          isArchiving={false}
          error={null}
          onArchive={(remove) => requests.push(remove)}
          onClose={() => {}}
        />
      </QueryProvider>,
    );
    try {
      const toggle = view.getByRole("switch", { name: "Remove worktree and branch" });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      const submit = view.getByRole("button", { name: "Archive chat" });
      expect(submit.hasAttribute("disabled")).toBe(true);
      await waitFor(() => expect(finish).toBeDefined(), { timeout: 800 });
      finish({ branchName: "feature/chat", worktreeExists: true, hasUncommittedChanges: dirty });
      await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false), { timeout: 800 });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(view.queryByText(/This worktree has local changes/) !== null).toBe(dirty);
      expect(view.getByText(/Commits that exist only on this branch/).textContent).toContain(
        "feature/chat",
      );
      expect(view.getByText(/Archiving stops this session if it is running/)).toBeTruthy();
      fireEvent.click(submit);
      expect(requests).toEqual([true]);
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("turning removal off keeps Git resources and Cancel sends no archive request", async () => {
  const requests: boolean[] = [];
  let closed = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionArchivePreview: async () => ({
          branchName: "feature/chat",
          worktreeExists: true,
          hasUncommittedChanges: true,
        }),
      },
    }),
  );
  const view = render(
    <QueryProvider useIsolatedClient>
      <WorkspaceSessionArchiveDialog
        workspaceId="test"
        record={record()}
        isArchiving={false}
        error={null}
        onArchive={(remove) => requests.push(remove)}
        onClose={() => {
          closed += 1;
        }}
      />
    </QueryProvider>,
  );
  try {
    await view.findByText(/This worktree has local changes/, {}, { timeout: 800 });
    expect(view.getByText(/Archiving stops this session if it is running/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(closed).toBe(1);
    expect(requests).toEqual([]);
    fireEvent.click(view.getByRole("switch"));
    expect(view.queryByText(/This worktree has local changes/)).toBeNull();
    expect(view.getByText("The worktree and its branch will stay on disk.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a missing detached worktree can be archived without removal", async () => {
  const requests: boolean[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionArchivePreview: async () => ({
          branchName: null,
          worktreeExists: false,
          hasUncommittedChanges: false,
        }),
      },
    }),
  );
  const imported = record();
  imported.externalSessionId = "native-detached";
  if (imported.executionTarget.kind !== "local_worktree") throw new Error("Expected worktree");
  imported.executionTarget.branchName = null;
  const view = render(
    <QueryProvider useIsolatedClient>
      <WorkspaceSessionArchiveDialog
        workspaceId="test"
        record={imported}
        isArchiving={false}
        error={null}
        onArchive={(remove) => requests.push(remove)}
        onClose={() => {}}
      />
    </QueryProvider>,
  );
  try {
    await view.findByText(/No branch is attached/, {}, { timeout: 800 });
    const submit = view.getByRole("button", { name: "Archive chat" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("switch", { name: "Remove worktree and branch" }));
    expect(
      view.getByText(/Restore the worktree at this path before restoring the chat/),
    ).toBeTruthy();
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a failed check blocks removal but allows keeping the worktree", async () => {
  const requests: boolean[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionArchivePreview: async () => {
          throw new Error("Cannot delete protected branch main.");
        },
      },
    }),
  );
  const view = render(
    <QueryProvider useIsolatedClient>
      <WorkspaceSessionArchiveDialog
        workspaceId="test"
        record={record()}
        isArchiving={false}
        error={null}
        onArchive={(remove) => requests.push(remove)}
        onClose={() => {}}
      />
    </QueryProvider>,
  );
  try {
    await view.findByText("Cannot delete protected branch main.", {}, { timeout: 800 });
    expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    const submit = view.getByRole("button", { name: "Archive chat" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("switch"));
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("archive locks the full form and keeps its error and removal choice visible for retry", async () => {
  let closed = 0;
  const requests: boolean[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionArchivePreview: async () => ({
          branchName: "feature/chat",
          worktreeExists: false,
          hasUncommittedChanges: false,
        }),
      },
    }),
  );
  const props = {
    workspaceId: "test",
    record: record(),
    onArchive: (remove: boolean) => requests.push(remove),
    onClose: () => {
      closed += 1;
    },
  };
  const view = render(
    <QueryProvider useIsolatedClient>
      <WorkspaceSessionArchiveDialog {...props} isArchiving error={null} />
    </QueryProvider>,
  );
  try {
    await view.findByText(/worktree is already missing/, {}, { timeout: 800 });
    const toggle = view.getByRole("switch");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Cancel" }).closest("fieldset")?.disabled).toBe(true);
    expect(view.getByRole("button", { name: "Archiving…" }).hasAttribute("disabled")).toBe(true);
    expect(view.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(closed).toBe(0);
    expect(requests).toEqual([]);
    view.rerender(
      <QueryProvider useIsolatedClient>
        <WorkspaceSessionArchiveDialog
          {...props}
          isArchiving={false}
          error={new Error("Branch removal failed")}
        />
      </QueryProvider>,
    );
    expect(view.getByText("Branch removal failed")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    expect(requests).toEqual([true]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});
