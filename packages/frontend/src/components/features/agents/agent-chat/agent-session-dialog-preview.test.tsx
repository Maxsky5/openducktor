import { expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  createDialogPreviewHarness,
  dialogTargets,
  dialogTextFile,
} from "./agent-session-dialog-preview-test-harness";

for (const dismissal of ["close", "escape", "outside"] as const) {
  test(`dialog host guards dirty ${dismissal} dismissal and restores editor focus`, async () => {
    const h = createDialogPreviewHarness();
    try {
      await h.open();
      await h.selectFile();
      await h.edit();
      const dismiss = async () => {
        if (dismissal === "close") fireEvent.click(screen.getByRole("button", { name: "Close" }));
        else if (dismissal === "escape")
          fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        else {
          await h.frames.flushTimers();
          const overlay = document.querySelector('[data-slot="dialog-overlay"]');
          if (!overlay) throw new Error("Expected the modal overlay");
          fireEvent(overlay, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
          fireEvent.click(overlay);
        }
      };
      await dismiss();
      const discard = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
      expect(discard.contains(document.activeElement)).toBe(true);
      fireEvent.click(within(discard).getByRole("button", { name: "Keep editing" }));
      await waitFor(() =>
        expect(document.activeElement === screen.getByLabelText("Code editor")).toBe(true),
      );
      expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
      await dismiss();
      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
      await waitFor(() => expect(screen.queryByLabelText("Selected file preview")).toBeNull());
      expect(screen.queryByRole("dialog")).toBeNull();
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

for (const target of [dialogTargets.child, dialogTargets.other]) {
  test(`dirty target replacement waits for discard: ${target.externalSessionId}`, async () => {
    const h = createDialogPreviewHarness();
    try {
      await h.open();
      await h.selectFile();
      await h.edit();
      await h.open(target);
      fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
      expect(screen.getByText("Conversation main")).toBeTruthy();
      expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
      await h.open(target);
      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
      await h.frames.flushFrames();
      await h.selectFile();
      expect(screen.getByText(`Conversation ${target.externalSessionId}`)).toBeTruthy();
      expect(
        screen.getByDisplayValue(`Contents of /repo/${target.sessionScope.taskId}`),
      ).toBeTruthy();
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });
}

for (const departure of ["close", "same-task", "task", "repository"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`dialog host defers ${departure} until save ${outcome}`, async () => {
      const h = createDialogPreviewHarness();
      const deferred = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
      h.write.mockImplementationOnce(() => deferred.promise);
      try {
        await h.open();
        await h.selectFile();
        await h.edit();
        fireEvent.click(screen.getByRole("button", { name: "Save file" }));
        await screen.findByRole("button", { name: "Saving file" });
        if (departure === "close") h.close();
        else if (departure === "repository") h.changeRepo(null);
        else await h.open(departure === "same-task" ? dialogTargets.child : dialogTargets.other);
        expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
        expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
        expect(screen.getByText("Conversation main")).toBeTruthy();
        await act(async () => {
          if (outcome === "success") deferred.resolve(dialogTextFile("/repo/a", "Local draft"));
          else deferred.reject(new Error("Save denied"));
        });
        if (outcome === "failure" && departure !== "repository") {
          await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
          fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
          expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
          expect(screen.getByText("Save denied")).toBeTruthy();
          expect(screen.getByText("Conversation main")).toBeTruthy();
        } else {
          await waitFor(() => expect(screen.queryByLabelText("Selected file preview")).toBeNull());
          await h.frames.flushFrames();
          if (departure === "close" || departure === "repository")
            expect(screen.queryByRole("dialog")).toBeNull();
          else {
            await h.selectFile();
            const taskId = departure === "same-task" ? "a" : "b";
            expect(
              screen.getByDisplayValue(
                outcome === "success" && taskId === "a"
                  ? "Local draft"
                  : `Contents of /repo/${taskId}`,
              ),
            ).toBeTruthy();
          }
        }
        expect(h.write).toHaveBeenCalledTimes(1);
        expect(h.write).toHaveBeenCalledWith({
          rootPath: "/repo/a",
          relativePath: "src/file.ts",
          contents: "Local draft",
          revision: "revision:Contents of /repo/a",
        });
      } finally {
        h.dispose();
      }
    });
  }
}

for (const readKind of ["worktree", "file"] as const) {
  for (const departure of ["close", "reopen", "target", "repository"] as const) {
    test(`late ${readKind} read cannot restore a preview after ${departure}`, async () => {
      const h = createDialogPreviewHarness();
      const pendingFile = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
      const pendingWorktree = Promise.withResolvers<{ workingDirectory: string }>();
      let request: Promise<unknown> | undefined;
      if (readKind === "file") h.read.mockImplementationOnce(() => pendingFile.promise);
      else {
        const { taskWorktreeQueryOptions } = await import("@/state/queries/build-runtime");
        const options = taskWorktreeQueryOptions({
          repoPath: "/repo",
          taskId: "a",
          hostClient: { taskWorktreeGet: () => pendingWorktree.promise },
        });
        h.client.removeQueries({ queryKey: options.queryKey });
        request = h.client.fetchQuery(options);
      }
      try {
        await h.open();
        fireEvent.click(await screen.findByRole("link", { name: "Open file" }));
        if (readKind === "file") await waitFor(() => expect(h.read).toHaveBeenCalledTimes(1));
        if (departure === "repository") h.changeRepo(null);
        else if (departure === "target") await h.open(dialogTargets.other);
        else {
          h.close();
          if (departure === "reopen") await h.open();
        }
        await act(async () => {
          pendingFile.resolve(dialogTextFile("/repo/a", "Old result"));
          pendingWorktree.resolve({ workingDirectory: "/repo/a" });
          await request;
        });
        expect(screen.queryByLabelText("Selected file preview")).toBeNull();
        if (departure === "close" || departure === "repository")
          expect(screen.queryByRole("dialog")).toBeNull();
        else {
          expect(screen.getByRole("link", { name: "Open file" })).toBeTruthy();
          if (departure === "target") {
            await h.selectFile();
            expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
          }
        }
      } finally {
        h.dispose();
      }
    });
  }
}

test("nested conflict and discard dialogs keep focus and the draft in the conversation", async () => {
  const { HostInvokeError } = await import("@openducktor/host-client");
  const h = createDialogPreviewHarness();
  try {
    await h.open();
    const link = await h.selectFile();
    await h.edit();
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review latest file" })).toBeNull(),
    );
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
    await h.frames.flushTimers();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Code editor");
    fireEvent.click(review);
    await screen.findByRole("dialog", { name: "Review latest file" });
    fireEvent.click(screen.getByRole("button", { name: "Use latest as baseline" }));
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    const discard = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(discard.contains(document.activeElement)).toBe(true);
    await h.frames.flushTimers();
    fireEvent.keyDown(document.activeElement ?? discard, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull(),
    );
    expect(screen.getByDisplayValue("Local draft")).toBeTruthy();
    expect(document.activeElement === screen.getByLabelText("Code editor")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(screen.getByRole("link", { name: "Open file" }) === link).toBe(true);
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
    expect(screen.queryByRole("dialog")).toBeNull();
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
    await h.edit();
    await h.open(dialogTargets.child);
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    h.changeRepo(null);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    h.changeRepo("/repo");
    await h.open(dialogTargets.other);
    await h.selectFile();
    expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
    expect(h.write).not.toHaveBeenCalled();
  } finally {
    h.dispose();
  }
});

for (const kind of ["file", "worktree"] as const) {
  test(`failed ${kind} read after dialog replacement cannot show an old error`, async () => {
    const { spyOn } = await import("bun:test");
    const { toast } = await import("sonner");
    const error = spyOn(toast, "error").mockReturnValue("error");
    const h = createDialogPreviewHarness();
    const deferred = Promise.withResolvers<never>();
    let request: Promise<unknown> | undefined;
    if (kind === "file") h.read.mockImplementationOnce(() => deferred.promise);
    else {
      const { taskWorktreeQueryOptions } = await import("@/state/queries/build-runtime");
      const options = taskWorktreeQueryOptions({
        repoPath: "/repo",
        taskId: "a",
        hostClient: { taskWorktreeGet: () => deferred.promise },
      });
      h.client.removeQueries({ queryKey: options.queryKey });
      request = h.client.fetchQuery(options).catch(() => undefined);
    }
    try {
      await h.open();
      fireEvent.click(await screen.findByRole("link", { name: "Open file" }));
      if (kind === "file") await waitFor(() => expect(h.read).toHaveBeenCalledTimes(1));
      await h.open(dialogTargets.other);
      await act(async () => {
        deferred.reject(new Error("Old read failed"));
        await request;
      });
      expect(screen.queryByText("Old read failed")).toBeNull();
      expect(screen.queryByLabelText("Selected file preview")).toBeNull();
      expect(error).not.toHaveBeenCalled();
      await h.selectFile();
      expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
    } finally {
      h.dispose();
      error.mockRestore();
    }
  });
}
