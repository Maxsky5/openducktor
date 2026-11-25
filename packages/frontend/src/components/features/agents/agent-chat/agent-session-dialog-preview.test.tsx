import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HostInvokeError } from "@openducktor/host-client";
import { toast } from "sonner";
import { taskWorktreeQueryOptions } from "@openducktor/frontend-core/queries/build-runtime";
import {
  createDialogPreviewHarness,
  dialogTargets,
  dialogTextFile,
} from "./agent-session-dialog-preview-test-harness";

for (const href of ["src/file.ts", "/alias/a/src/file.ts:42"]) {
  test(`an aliased task worktree opens the canonical preview for ${href}`, async () => {
    const h = createDialogPreviewHarness(href);
    h.client.setQueryData(
      taskWorktreeQueryOptions({ workspaceId: "workspace", repoPath: "/repo", taskId: "a" })
        .queryKey,
      () => ({
        workingDirectory: "/alias/a",
      }),
    );
    h.canonicalize.mockImplementation(async (path) =>
      path.replace("/alias/a", "/real/a").replace("/repo/a", "/real/a"),
    );
    h.resolvePath.mockResolvedValue("/real/a");
    const expectedFile = { rootPath: "/real/a", relativePath: "src/file.ts" };
    h.read.mockImplementation(async ({ rootPath, relativePath }) => ({
      ...dialogTextFile(rootPath),
      relativePath,
    }));
    try {
      await h.open();
      await h.selectFile();
      expect(screen.getByDisplayValue(`Contents of ${expectedFile.rootPath}`)).toBeTruthy();
      expect(h.read).toHaveBeenCalledWith(expectedFile);
    } finally {
      h.dispose();
    }
  });
}

for (const dismissal of ["close", "escape", "outside"] as const) {
  test(`dialog host guards dirty ${dismissal} dismissal and restores editor focus`, async () => {
    const h = createDialogPreviewHarness();
    try {
      await h.open();
      await h.selectFile();
      h.edit();
      const dismiss = async () => {
        if (dismissal === "outside") {
          await h.frames.flushTimers();
          const overlay = document.querySelector('[data-slot="dialog-overlay"]');
          if (!overlay) throw new Error("Expected the modal overlay");
          await act(async () => {
            fireEvent(overlay, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
            fireEvent.click(overlay);
          });
        } else if (dismissal === "escape") {
          await act(async () =>
            fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }),
          );
        } else {
          await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close" })));
        }
      };
      await dismiss();
      const discard = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
      expect(discard.contains(document.activeElement)).toBe(true);
      fireEvent.click(within(discard).getByRole("button", { name: "Keep editing" }));
      await h.frames.flushTimers();
      expect(document.activeElement === screen.getByLabelText("Code editor")).toBe(true);
      expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
      await dismiss();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard" })));
      expect(screen.queryByLabelText("Selected file preview") === null).toBe(true);
      if (dismissal === "escape") {
        expect(screen.getByRole("link", { name: "Open file" })).toBeTruthy();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      }
      expect(screen.queryByRole("dialog") === null).toBe(true);
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });
}

test("dialog host keeps main and child links on their shared task root and isolates another task", async () => {
  const h = createDialogPreviewHarness();
  try {
    for (const target of [dialogTargets.main, dialogTargets.child, dialogTargets.other]) {
      await h.open(target);
      const link = await h.selectFile();
      expect(
        screen.getByDisplayValue(`Contents of /repo/${target.sessionScope.taskId}`),
      ).toBeTruthy();
      expect(h.read).toHaveBeenLastCalledWith({
        rootPath: `/repo/${target.sessionScope.taskId}`,
        relativePath: "src/file.ts",
      });
      fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
      expect(screen.getByRole("link", { name: "Open file" }) === link).toBe(true);
      expect(document.activeElement === link).toBe(true);
    }
  } finally {
    h.dispose();
  }
});

test("switching to a child transcript waits for discard even within the same task", async () => {
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    await h.selectFile();
    h.edit();
    await h.open(dialogTargets.child);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("Conversation main")).toBeTruthy();
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();

    await h.open(dialogTargets.child);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await h.frames.flushFrames();
    await h.selectFile();
    expect(screen.getByText("Conversation child")).toBeTruthy();
    expect(screen.getByDisplayValue("Contents of /repo/a")).toBeTruthy();
    expect(h.write).not.toHaveBeenCalled();
  } finally {
    h.dispose();
  }
});

test.each([
  ["close", "success"],
  ["same-task", "success"],
  ["task", "success"],
  ["task", "failure"],
  ["repository", "failure"],
] as const)("dialog host defers %s until save %s", async (departure, outcome) => {
  const h = createDialogPreviewHarness();
  const deferred = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
  h.write.mockImplementationOnce(() => deferred.promise);
  try {
    await h.open();
    await h.selectFile();
    h.edit();
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(screen.getByRole("button", { name: "Saving file" })).toBeTruthy();
    if (departure === "close") h.close();
    else if (departure === "repository") h.changeRepo(null);
    else await h.open(departure === "same-task" ? dialogTargets.child : dialogTargets.other);
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" }) === null).toBe(true);
    expect(screen.getByText("Conversation main")).toBeTruthy();

    await act(async () => {
      if (outcome === "success") deferred.resolve(dialogTextFile("/repo/a", "Local draft"));
      else deferred.reject(new Error("Save denied"));
    });

    if (outcome === "failure" && departure === "task") {
      const discard = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
      fireEvent.click(within(discard).getByRole("button", { name: "Keep editing" }));
      expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
      expect(screen.getByText("Save denied")).toBeTruthy();
      expect(screen.getByText("Conversation main")).toBeTruthy();
    } else {
      expect(screen.queryByLabelText("Selected file preview") === null).toBe(true);
      await h.frames.flushFrames();
      if (departure === "close" || departure === "repository") {
        expect(screen.queryByRole("dialog") === null).toBe(true);
      } else {
        await h.selectFile();
        expect(
          screen.getByDisplayValue(
            departure === "same-task" ? "Local draft" : "Contents of /repo/b",
          ),
        ).toBeTruthy();
      }
    }
    expect(h.write.mock.calls).toEqual([
      [
        {
          rootPath: "/repo/a",
          relativePath: "src/file.ts",
          contents: "Local draft",
          revision: "revision:Contents of /repo/a",
        },
      ],
    ]);
  } finally {
    h.dispose();
  }
});

test.each([
  ["worktree", "reopen", "success"],
  ["worktree", "target", "failure"],
  ["file", "close", "success"],
  ["file", "reopen", "success"],
  ["file", "target", "failure"],
  ["file", "repository", "success"],
] as const)("ignores a late %s read after %s (%s)", async (kind, departure, outcome) => {
  const h = createDialogPreviewHarness();
  const toastError = spyOn(toast, "error");
  const pendingFile = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
  const pendingWorktree = Promise.withResolvers<{ workingDirectory: string }>();
  if (kind === "file") {
    h.read.mockImplementationOnce(() => pendingFile.promise);
  } else {
    h.worktree.mockImplementationOnce(() => pendingWorktree.promise);
    h.client.removeQueries({
      queryKey: taskWorktreeQueryOptions({
        workspaceId: "workspace",
        repoPath: "/repo",
        taskId: "a",
      }).queryKey,
    });
  }
  try {
    await h.open();
    fireEvent.click(screen.getByRole("link", { name: "Open file" }));
    await waitFor(() => expect(kind === "file" ? h.read : h.worktree).toHaveBeenCalledTimes(1));
    if (departure === "repository") h.changeRepo(null);
    else if (departure === "target") await h.open(dialogTargets.other);
    else {
      h.close();
      if (departure === "reopen") await h.open();
    }

    await act(async () => {
      if (outcome === "failure") {
        const error = new Error("Old read failed");
        if (kind === "file") pendingFile.reject(error);
        else pendingWorktree.reject(error);
      } else {
        pendingFile.resolve(dialogTextFile("/repo/a", "Old result"));
        pendingWorktree.resolve({ workingDirectory: "/repo/a" });
      }
    });
    expect(screen.queryByText("Old read failed") === null).toBe(true);
    expect(screen.queryByLabelText("Selected file preview") === null).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    if (departure === "close" || departure === "repository") {
      expect(screen.queryByRole("dialog") === null).toBe(true);
    } else {
      await h.selectFile();
      expect(
        screen.getByDisplayValue(`Contents of /repo/${departure === "target" ? "b" : "a"}`),
      ).toBeTruthy();
    }
  } finally {
    toastError.mockRestore();
    h.dispose();
  }
});

test("nested conflict and discard dialogs keep focus and the draft in the conversation", async () => {
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    const link = await h.selectFile();
    h.edit();
    h.write.mockRejectedValueOnce(
      new HostInvokeError("The file changed after it was loaded.", {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: "/repo/a",
          relativePath: "src/file.ts",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    const review = await screen.findByRole("button", { name: "Review latest version" });
    review.focus();
    h.read.mockResolvedValueOnce(dialogTextFile("/repo/a", "External contents"));
    fireEvent.click(review);
    const conflict = await screen.findByRole("dialog", { name: "Review latest file" });
    expect(conflict.contains(document.activeElement)).toBe(true);
    expect(within(conflict).getByText("External contents")).toBeTruthy();
    await h.frames.flushTimers();
    fireEvent.keyDown(document.activeElement ?? conflict, { key: "Escape", cancelable: true });
    expect(screen.queryByRole("dialog", { name: "Review latest file" }) === null).toBe(true);
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
    await h.frames.flushTimers();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Code editor");
    fireEvent.click(review);
    await screen.findByRole("dialog", { name: "Review latest file" });
    fireEvent.click(screen.getByRole("button", { name: "Allow overwrite on save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close file preview" }));
    const discard = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(discard.contains(document.activeElement)).toBe(true);
    await h.frames.flushTimers();
    fireEvent.keyDown(document.activeElement ?? discard, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" }) === null).toBe(true);
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
    await h.frames.flushTimers();
    expect(document.activeElement === screen.getByLabelText("Code editor")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("link", { name: "Open file" }) === link).toBe(true);
    await h.frames.flushTimers();
    expect(document.activeElement === link).toBe(true);
  } finally {
    h.dispose();
  }
});

test("closing before the content frame prevents the old target from mounting after reopen", async () => {
  const h = createDialogPreviewHarness();
  try {
    // Start opening before the host's two content frames run.
    const opening = h.open();
    h.close();
    await opening;
    expect(screen.queryByRole("dialog") === null).toBe(true);
    await h.open(dialogTargets.other);
    await h.selectFile();
    expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
    expect(h.read).toHaveBeenCalledTimes(1);
  } finally {
    h.dispose();
  }
});

test("forced repository removal cancels a pending dirty target change", async () => {
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    await h.selectFile();
    h.edit();
    await h.open(dialogTargets.child);
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    h.changeRepo(null);
    await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true));
    h.changeRepo("/repo");
    await h.open(dialogTargets.other);
    await h.selectFile();
    expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
    expect(h.write).not.toHaveBeenCalled();
  } finally {
    h.dispose();
  }
});

test("Escape closes the clean file preview before the transcript", async () => {
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    const link = await h.selectFile();
    fireEvent.keyDown(screen.getByLabelText("Code editor"), { key: "Escape" });
    expect(screen.queryByLabelText("Selected file preview") === null).toBe(true);
    expect(screen.getByRole("dialog", { name: "Conversation main" })).toBeTruthy();
    expect(document.activeElement === link).toBe(true);
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByRole("dialog") === null).toBe(true);
  } finally {
    h.dispose();
  }
});

for (const outcome of ["success", "failure"] as const) {
  test(`Escape cannot close a saving preview and works again after ${outcome}`, async () => {
    const h = createDialogPreviewHarness();
    const deferred = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
    h.write.mockImplementationOnce(() => deferred.promise);
    try {
      await h.open();
      const link = await h.selectFile();
      h.edit();
      fireEvent.click(screen.getByRole("button", { name: "Save file" }));
      expect(screen.getByRole("button", { name: "Saving file" })).toBeTruthy();
      fireEvent.keyDown(screen.getByLabelText("Code editor"), { key: "Escape" });
      expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
      await act(async () => {
        if (outcome === "success") deferred.resolve(dialogTextFile("/repo/a", "Local draft"));
        else deferred.reject(new Error("Save denied"));
      });
      expect(screen.getByLabelText("Selected file preview")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" }) === null).toBe(
        true,
      );
      fireEvent.keyDown(screen.getByLabelText("Code editor"), { key: "Escape" });
      if (outcome === "failure") {
        fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
        expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
        await h.frames.flushTimers();
        expect(document.activeElement === screen.getByLabelText("Code editor")).toBe(true);
      } else {
        expect(screen.queryByLabelText("Selected file preview") === null).toBe(true);
        expect(document.activeElement === link).toBe(true);
      }
      expect(screen.getByRole("dialog", { name: "Conversation main" })).toBeTruthy();
    } finally {
      h.dispose();
    }
  });
}

test("closing a replacement transcript preview focuses its own link", async () => {
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    const oldLink = await h.selectFile();
    const oldFocus = spyOn(oldLink, "focus");
    try {
      await h.open(dialogTargets.other);
      const newLink = await h.selectFile();
      fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
      expect(document.activeElement === newLink).toBe(true);
      expect(oldFocus).not.toHaveBeenCalled();
    } finally {
      oldFocus.mockRestore();
    }
  } finally {
    h.dispose();
  }
});
