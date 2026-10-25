import { expect, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";

// The dialog keeps its loader for at least 500 ms, then shows the final state.
const SETTLED = { timeout: 1_500 };

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
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

test.each([false, true])(
  "removal stays enabled by default after the worktree check, dirty=%s",
  async (dirty) => {
    const requests: boolean[] = [];
    let finish!: (preview: WorkspaceSessionArchivePreview) => void;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionArchivePreview: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    // The loader starts while the dialog renders.
    const startedAt = performance.now();
    const view = render(
      <QueryProvider connection={connection}>
        <WorkspaceSessionArchiveDialog
          open
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
      expect(view.getByText("Checking the worktree…")).toBeTruthy();
      expect(view.queryByRole("switch")).toBeNull();
      const submit = view.getByRole("button", { name: "Archive chat" });
      expect(submit.hasAttribute("disabled")).toBe(true);
      await waitFor(() => expect(finish).toBeDefined(), SETTLED);
      finish({
        branchName: "feature/chat",
        worktreeExists: true,
        hasUncommittedChanges: dirty,
        sharedWith: [],
        taskOwners: [],
      });
      const toggle = await view.findByRole(
        "switch",
        { name: "Remove worktree and branch" },
        SETTLED,
      );
      // The final content and buttons appear together, after the minimum loader time.
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(500);
      expect(view.queryByText("Checking the worktree…")).toBeNull();
      expect(submit.hasAttribute("disabled")).toBe(false);
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(view.queryByText(/This worktree has local changes/) !== null).toBe(dirty);
      expect(view.getByText(/Commits that exist only on this branch/).textContent).toContain(
        "feature/chat",
      );
      expect(
        view.getByText(
          /Archiving stops this chat's terminals, development servers, and its running session/,
        ),
      ).toBeTruthy();
      fireEvent.click(submit);
      expect(requests).toEqual([true]);
    } finally {
      view.unmount();
    }
  },
);

test("saved chat history disables worktree removal and still allows archive", async () => {
  const requests: boolean[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => ({
        branchName: "feature/chat",
        worktreeExists: true,
        hasUncommittedChanges: false,
        sharedWith: [
          { workspaceId: "test", sessionId: "archived-child", title: "Archived child chat" },
        ],
        taskOwners: [],
      }),
    },
  });
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog
        open
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
    await view.findByText(
      "This worktree stays because these saved chats need it for files or history: Archived child chat.",
      {},
      SETTLED,
    );
    const toggle = view.getByRole("switch", { name: "Remove worktree and branch" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    const submit = view.getByRole("button", { name: "Archive chat" });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
  }
});

test("a task that needs the worktree disables its removal, names the task, and still allows archive", async () => {
  const requests: boolean[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => ({
        branchName: "feature/chat",
        worktreeExists: true,
        hasUncommittedChanges: false,
        sharedWith: [],
        taskOwners: [{ workspaceId: "test", taskId: "task-7", title: "Fix login" }],
      }),
    },
  });
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog
        open
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
    await view.findByText(
      "This worktree stays because these tasks need it: Fix login (task-7).",
      {},
      SETTLED,
    );
    const toggle = view.getByRole("switch", { name: "Remove worktree and branch" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
  }
});

test("turning removal off keeps Git resources and Cancel sends no archive request", async () => {
  const requests: boolean[] = [];
  let closed = 0;
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => ({
        branchName: "feature/chat",
        worktreeExists: true,
        hasUncommittedChanges: true,
        sharedWith: [],
        taskOwners: [],
      }),
    },
  });
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog
        open
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
    await view.findByText(/This worktree has local changes/, {}, SETTLED);
    expect(
      view.getByText(
        /Archiving stops this chat's terminals, development servers, and its running session/,
      ),
    ).toBeTruthy();
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
  }
});

test("a missing detached worktree can be archived without removal", async () => {
  const requests: boolean[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => ({
        branchName: null,
        worktreeExists: false,
        hasUncommittedChanges: false,
        sharedWith: [],
        taskOwners: [],
      }),
    },
  });
  const imported = record();
  imported.externalSessionId = "native-detached";
  if (imported.executionTarget.kind !== "local_worktree") throw new Error("Expected worktree");
  imported.executionTarget.branchName = null;
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog
        open
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
    await view.findByText(/No branch is attached/, {}, SETTLED);
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
  }
});

test("a failed saved history check blocks removal but allows keeping the worktree", async () => {
  const requests: boolean[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => {
        throw new Error("Cannot check saved chat history.");
      },
    },
  });
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog
        open
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
    await view.findByText("Cannot check saved chat history.", {}, SETTLED);
    const toggle = view.getByRole("switch", { name: "Remove worktree and branch" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    const submit = view.getByRole("button", { name: "Archive chat" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(view.getByRole("alert").textContent).toContain("Cannot check saved chat history.");
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(requests).toEqual([false]);
  } finally {
    view.unmount();
  }
});

test("archive locks the full form and keeps its error and removal choice visible for retry", async () => {
  let closed = 0;
  const requests: boolean[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionArchivePreview: async () => ({
        branchName: "feature/chat",
        worktreeExists: false,
        hasUncommittedChanges: false,
        sharedWith: [],
        taskOwners: [],
      }),
    },
  });
  const props = {
    workspaceId: "test",
    record: record(),
    onArchive: (remove: boolean) => requests.push(remove),
    onClose: () => {
      closed += 1;
    },
  };
  const view = render(
    <QueryProvider connection={connection}>
      <WorkspaceSessionArchiveDialog open {...props} isArchiving error={null} />
    </QueryProvider>,
  );
  try {
    await view.findByText(/worktree is already missing/, {}, SETTLED);
    const toggle = view.getByRole("switch");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Cancel" }).closest("fieldset")?.disabled).toBe(true);
    expect(view.getByRole("button", { name: "Archiving…" }).hasAttribute("disabled")).toBe(true);
    expect(view.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(closed).toBe(0);
    expect(requests).toEqual([]);
    view.rerender(
      <QueryProvider connection={connection}>
        <WorkspaceSessionArchiveDialog
          open
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
  }
});
