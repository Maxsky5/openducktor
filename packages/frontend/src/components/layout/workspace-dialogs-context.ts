import type { IssueImportProvider } from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import { createContext, use } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";

// The context lives apart from its provider component, so a hot reload of the provider keeps the
// same context object for its consumers.

/** A dialog keeps the workspace that was active when it opened, so a submission never moves. */
export type WorkspaceDialogRequest =
  | { kind: "chat" | "archived_chats" | "import_chat"; workspace: ActiveWorkspace }
  | { kind: "import_tasks"; workspace: ActiveWorkspace; provider: IssueImportProvider };

export type WorkspaceDialogsContextValue = {
  /**
   * Open a workspace dialog. When it closes, focus goes to `returnFocus` unless another dialog
   * took focus.
   */
  openWorkspaceDialog: (request: WorkspaceDialogRequest, returnFocus: HTMLElement | null) => void;
};

export const WorkspaceDialogsContext = createContext<WorkspaceDialogsContextValue | null>(null);

export function useWorkspaceDialogs(): WorkspaceDialogsContextValue {
  const value = use(WorkspaceDialogsContext);
  if (!value) throw new Error("useWorkspaceDialogs must be used inside WorkspaceDialogsProvider.");
  return value;
}
