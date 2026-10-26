import type { WorkspaceSession } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useHostClient } from "../connection/client-connection-react";
import { useSingleFlightMutation } from "../lib/use-single-flight";
import { updateWorkspaceSessionQueries } from "../queries/workspace-sessions";

export const RENAME_CHAT_TEXT = {
  title: "Rename chat",
  description: "Leave the name blank to use the generated title.",
  nameLabel: "Name",
  save: "Save",
  saving: "Saving…",
} as const;

/** The form starts with the shown title. A blank name returns the chat to its generated title. */
export const workspaceSessionRenameInitialTitle = (record: WorkspaceSession): string =>
  record.manualTitle ?? record.generatedTitle ?? "";

export const canSaveWorkspaceSessionRename = ({
  initialTitle,
  draft,
  isPending,
}: {
  initialTitle: string;
  draft: string;
  isPending: boolean;
}): boolean => draft.trim() !== initialTitle && !isPending;

/** Rename a chat and update every chat list that shows it. It sends one rename at a time. */
export const useRenameWorkspaceSession = ({
  workspaceId,
  sessionId,
  onRenamed,
}: {
  workspaceId: string;
  sessionId: string;
  onRenamed: (session: WorkspaceSession) => void;
}) => {
  const host = useHostClient();
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: (manualTitle: string) =>
      host.workspaceSessionRename({ workspaceId, sessionId, manualTitle }),
    onSuccess: (session) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
      onRenamed(session);
    },
  });
};
