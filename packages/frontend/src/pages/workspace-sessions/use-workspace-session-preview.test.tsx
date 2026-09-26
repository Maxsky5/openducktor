import { expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { useWorkspaceSessionPreview } from "./use-workspace-session-preview";

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };
const secondFile = { rootPath: "/repo", relativePath: "second.ts" };

function SessionPreview({
  selectedFile,
  onSelectionChange,
}: {
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectionChange: (file: TaskExecutionSelectedFile | null) => void;
}) {
  const { preview, onDiscard } = useWorkspaceSessionPreview(selectedFile, onSelectionChange);
  return (
    <>
      <output data-testid="selected-file">
        {preview.model.selectedFile?.relativePath ?? "none"}
      </output>
      <output data-testid="pending-discard">{String(preview.model.hasPendingDiscard)}</output>
      <button onClick={() => preview.onSelectFile(firstFile)}>Open first</button>
      <button onClick={() => preview.onSelectFile(secondFile)}>Open second</button>
      <button onClick={preview.model.onClose}>Close preview</button>
      <button onClick={() => preview.model.onLeavePolicyChange("confirm")}>Edit file</button>
      <button onClick={preview.model.onKeepEditing}>Keep editing</button>
      <button onClick={onDiscard}>Discard draft</button>
    </>
  );
}

function SessionHarness() {
  const { run } = useWorkspacePreviewTransitionGuard();
  const [activeSession, setActiveSession] = useState<"first" | "second">("first");
  const [selectedFiles, setSelectedFiles] = useState<{
    first: TaskExecutionSelectedFile | null;
    second: TaskExecutionSelectedFile | null;
  }>({ first: null, second: null });
  return (
    <>
      <output data-testid="active-session">{activeSession}</output>
      <button onClick={() => run(() => setActiveSession("first"))}>Switch to first</button>
      <button onClick={() => run(() => setActiveSession("second"))}>Switch to second</button>
      <SessionPreview
        key={activeSession}
        selectedFile={selectedFiles[activeSession]}
        onSelectionChange={(file) =>
          setSelectedFiles((current) => ({ ...current, [activeSession]: file }))
        }
      />
    </>
  );
}

test("keeps a closed preview closed after switching chats", async () => {
  const view = render(
    <WorkspacePreviewTransitionGuardProvider>
      <SessionHarness />
    </WorkspacePreviewTransitionGuardProvider>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    expect(screen.getByTestId("selected-file").textContent).toBe("first.ts");

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.getByTestId("selected-file").textContent).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    expect(screen.getByTestId("selected-file").textContent).toBe("none");
  } finally {
    view.unmount();
  }
});

test("keeps an unsaved preview open until the user discards the close request", async () => {
  const view = render(
    <WorkspacePreviewTransitionGuardProvider>
      <SessionHarness />
    </WorkspacePreviewTransitionGuardProvider>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.getByTestId("pending-discard").textContent).toBe("true");
    expect(screen.getByTestId("selected-file").textContent).toBe("first.ts");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByTestId("pending-discard").textContent).toBe("false");
    expect(screen.getByTestId("selected-file").textContent).toBe("first.ts");

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.getByTestId("selected-file").textContent).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    expect(screen.getByTestId("selected-file").textContent).toBe("none");
  } finally {
    view.unmount();
  }
});

test("keeps a newly selected file after discarding another draft and returning to the session", async () => {
  const view = render(
    <WorkspacePreviewTransitionGuardProvider>
      <SessionHarness />
    </WorkspacePreviewTransitionGuardProvider>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    await waitFor(() => expect(screen.getByTestId("selected-file").textContent).toBe("first.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));
    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    expect(screen.getByTestId("pending-discard").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.getByTestId("selected-file").textContent).toBe("second.ts"));

    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    await waitFor(() => expect(screen.getByTestId("active-session").textContent).toBe("second"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    await waitFor(() => expect(screen.getByTestId("selected-file").textContent).toBe("second.ts"));

    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    expect(screen.getByTestId("pending-discard").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByTestId("active-session").textContent).toBe("first");
    expect(screen.getByTestId("selected-file").textContent).toBe("second.ts");
    fireEvent.click(screen.getByRole("button", { name: "Switch to second" }));
    expect(screen.getByTestId("pending-discard").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.getByTestId("active-session").textContent).toBe("second"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to first" }));
    await waitFor(() => expect(screen.getByTestId("selected-file").textContent).toBe("none"));
  } finally {
    view.unmount();
  }
});
