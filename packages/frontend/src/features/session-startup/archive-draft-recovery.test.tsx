import { useTaskExecutionFileEditor } from "@/components/features/agents/use-task-execution-file-editor";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { QueryProvider } from "@/test-utils/query-provider";
import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  workspaceSessionRecord,
  worktreeExecutionTarget,
} from "@openducktor/frontend-core/test-support/workspace-session-fixtures";
import { useArchiveWorkspaceSession } from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import { HostChannelRequestError, hostChannelInvokeError } from "@openducktor/host-client/channel";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { Toaster } from "sonner";
import { BackgroundOperationNotifications } from "./background-operation-notifications";

const workspace = { workspaceId: "workspace", repoPath: "/repo" };
const target = { kind: "chat", sessionId: "chat" } as const;
const workspaceSession = { workspaceId: workspace.workspaceId, sessionId: target.sessionId };
const file = { rootPath: "/worktrees/chat", relativePath: "notes.md" };
const baseline = {
  ...file,
  kind: "text",
  contents: "saved",
  size: 5,
  mtimeMs: null,
  revision: "original",
} as const;
const branch = "chat-branch";

function ArchiveEditor() {
  const archiveDraftRef = useRef<ArchiveFileDraft | null>(null);
  const editor = useTaskExecutionFileEditor({
    selectedFile: file,
    readyResult: baseline,
    branch,
    requireBranch: true,
    scope: { kind: "chat", session: workspaceSession },
    workspaceSession,
    archiveDraftRef,
    onFileSaved: () => {},
    onLeavePolicyChange: () => {},
  });
  const archive = useArchiveWorkspaceSession(workspace.workspaceId, target.sessionId);

  return (
    <>
      <textarea
        aria-label="File contents"
        value={editor.draftContents}
        onChange={(event) => editor.onContentsChange(event.currentTarget.value)}
      />
      <button
        type="button"
        onClick={() =>
          archive.submit(
            {
              ...workspace,
              sessionId: target.sessionId,
              confirmStop: true,
              removeWorktree: true,
              worktreeConfirmation: { workingDirectory: file.rootPath, branchName: branch },
            },
            { workspaceLabel: "Workspace", targetLabel: "Chat" },
            archiveDraftRef.current ?? undefined,
          )
        }
      >
        Confirm archive
      </button>
    </>
  );
}

test.each(["success", "partial failure"] as const)(
  "copies text first typed during archive after %s closes the editor",
  async (outcome) => {
    const reply = Promise.withResolvers<WorkspaceSession>();
    const started = Promise.withResolvers<string>();
    const connection = createTestClientConnection({
      client: {
        workspaceSessionArchive: (_input, tracking) => {
          if (!tracking) throw new Error("Archive did not request progress");
          started.resolve(tracking.operationId);
          return reply.promise;
        },
      },
    });
    const copied: string[] = [];
    const restoreClipboard = replaceNavigatorClipboard(async (text) => {
      copied.push(text);
    });
    const app = (open: boolean) => (
      <QueryProvider connection={connection}>
        <BackgroundOperationNotifications />
        <Toaster />
        {open ? <ArchiveEditor /> : null}
      </QueryProvider>
    );
    const view = render(app(true));
    try {
      const editor = view.getByRole("textbox", { name: "File contents" });
      if (!(editor instanceof HTMLTextAreaElement)) throw new Error("Expected a file editor");
      expect(editor.value).toBe("saved");
      fireEvent.click(view.getByRole("button", { name: "Confirm archive" }));
      const operationId = await started.promise;
      const draft = "typed after confirmation";
      fireEvent.change(editor, { target: { value: draft } });
      expect(editor.value).toBe(draft);
      await act(async () => {
        if (outcome === "success") {
          reply.resolve(
            workspaceSessionRecord(target.sessionId, {
              archivedAt: 2000,
              executionTarget: worktreeExecutionTarget({ worktreeState: "removed" }),
            }),
          );
        } else {
          const failure = {
            stage: "branches",
            code: "cleanup_failed",
            message: "Branch deletion failed.",
            nextAction: "Check the local branch.",
          };
          reply.reject(
            hostChannelInvokeError(
              new HostChannelRequestError({
                kind: "host",
                response: {
                  operationProgress: {
                    operationId,
                    workspace,
                    target,
                    hostInstanceId: "host",
                    revision: 4,
                    phase: "failed",
                    failure,
                    steps: [
                      {
                        id: "worktrees",
                        label: "Remove worktree",
                        state: "completed",
                        details: [],
                        resources: [{ kind: "worktree", value: file.rootPath, state: "removed" }],
                      },
                    ],
                  },
                },
              }),
            ),
          );
        }
      });
      view.rerender(app(false));
      expect(view.queryByRole("textbox", { name: "File contents" })).toBeNull();
      const copy = await view.findByRole(
        "button",
        { name: "Copy retained draft" },
        { timeout: 600 },
      );
      await act(async () => fireEvent.click(copy));
      expect(copied).toEqual([draft]);
    } finally {
      view.unmount();
      connection.backgroundOperations.dispose();
      restoreClipboard();
    }
  },
);
