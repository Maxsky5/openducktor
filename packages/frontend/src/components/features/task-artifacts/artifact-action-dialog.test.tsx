import { describe, expect, mock, test } from "bun:test";
import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type ArtifactSaveResult,
  type FreeTaskArtifact,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { ArtifactActionDialog, type ArtifactAction } from "./artifact-action-dialog";

const artifact: FreeTaskArtifact = {
  artifactId: "file-1",
  taskId: "task-1",
  name: "Build notes",
  revision: 1,
  updatedAt: "2026-10-22T12:00:00Z",
  classification: "free",
  code: "test-output",
  fileName: "notes.txt",
  mediaType: "text/plain",
  byteSize: 5,
};

const receipt: ArtifactSaveResult = {
  artifact,
  cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 },
};

function setup(action: ArtifactAction, client: Partial<HostClient>) {
  const connection = createTestClientConnection({ client });
  const onOpenChange = mock(() => {});
  const view = render(
    createElement(
      ClientConnectionProvider,
      { connection },
      createElement(ArtifactActionDialog, {
        action,
        repoPath: "/repo",
        taskId: "task-1",
        canManage: true,
        open: true,
        onOpenChange,
      }),
    ),
  );
  return {
    onOpenChange,
    close: () => {
      view.unmount();
      connection.queryClient.clear();
    },
  };
}

describe("artifact action dialog", () => {
  test("keeps a custom display name when the selected file changes and saves that file", async () => {
    const create = mock(async (_input: Parameters<HostClient["taskArtifactCreate"]>[0]) => receipt);
    const view = setup({ kind: "create" }, { taskArtifactCreate: create });
    try {
      const picker = screen.getByLabelText("File");
      const name = screen.getByLabelText<HTMLInputElement>("Display name");
      fireEvent.change(picker, {
        target: { files: [new File(["first"], "first.txt", { type: "text/plain" })] },
      });
      expect(name.value).toBe("first.txt");
      fireEvent.change(name, { target: { value: "Release notes" } });
      fireEvent.change(picker, {
        target: { files: [new File(["second"], "second.txt", { type: "text/plain" })] },
      });
      expect(name.value).toBe("Release notes");
      expect(screen.getByText("second.txt")).toBeTruthy();
      expect(screen.getByText("6 B")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Add artifact" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        fileName: "second.txt",
        name: "Release notes",
        dataBase64: "c2Vjb25k",
      });
      await waitFor(() => expect(view.onOpenChange).toHaveBeenCalledWith(false));
    } finally {
      view.close();
    }
  });

  test("rejects an oversized file before saving and accepts a smaller replacement", () => {
    const create = mock(async () => receipt);
    const view = setup({ kind: "create" }, { taskArtifactCreate: create });
    try {
      const picker = screen.getByLabelText("File");
      fireEvent.change(picker, {
        target: {
          files: [new File([new Uint8Array(TASK_ARTIFACT_MAX_FILE_BYTES + 1)], "large.bin")],
        },
      });
      expect(screen.getByRole("alert").textContent).toContain("exceeds the 10 MiB limit");
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add artifact" }).disabled).toBe(
        true,
      );
      expect(create).not.toHaveBeenCalled();
      fireEvent.change(picker, { target: { files: [new File(["small"], "small.txt")] } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByLabelText<HTMLInputElement>("Display name").value).toBe("small.txt");
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add artifact" }).disabled).toBe(
        false,
      );
    } finally {
      view.close();
    }
  });

  test.each([
    {
      message: "The artifact was removed. Open the collection again.",
      visible: "The artifact was removed. Open the collection again.",
    },
    {
      message: "Failed to fetch",
      visible: "Cannot reach the host. Check your host connection and try again.",
    },
  ])(
    "keeps the form disabled during a save and shows $message after failure",
    async ({ message, visible }) => {
      let rejectSave!: (reason: Error) => void;
      const rename = mock(
        () =>
          new Promise<ArtifactSaveResult>((_resolve, reject) => {
            rejectSave = reject;
          }),
      );
      const view = setup({ kind: "rename", artifact }, { taskArtifactRename: rename });
      try {
        const dialog = screen.getByRole("dialog");
        const name = within(dialog).getByLabelText<HTMLInputElement>("Display name");
        fireEvent.change(name, { target: { value: "Updated notes" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
        await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
        expect(isDisabled(name)).toBe(true);
        expect(isDisabled(within(dialog).getByRole("button", { name: "Cancel" }))).toBe(true);
        expect(isDisabled(within(dialog).getByRole("button", { name: "Renaming..." }))).toBe(true);
        expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
        await act(async () => rejectSave(new Error(message)));
        await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(visible));
        expect(isDisabled(name)).toBe(false);
        expect(name.value).toBe("Updated notes");
        expect(view.onOpenChange).not.toHaveBeenCalled();
      } finally {
        view.close();
      }
    },
  );
});

// Happy DOM does not include an ancestor fieldset in its :disabled selector.
function isDisabled(control: HTMLElement): boolean {
  return control.matches(":disabled") || control.closest("fieldset[disabled]") !== null;
}
