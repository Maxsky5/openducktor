import { sessionEntryLocation } from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { useSetSessionUnread } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import type { DraftDiscardPolicy } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { useDiscardWorkspaceDraft } from "@/features/new-chat/use-open-workspace-chat";
import { routes } from "@/navigation/routes";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import type { SessionMenuAction } from "./session-list-model";

export type RunSessionAction = (
  entry: SessionNavigationEntry,
  action: SessionMenuAction,
  unread: boolean,
) => void;

/** Runs a session menu action. Rename and archive open their sheets; the sheets send the commands. */
export const useSessionActions = (): RunSessionAction => {
  const router = useRouter();
  const { copyText } = useClipboardCopy();
  const setUnread = useSetSessionUnread();
  const discardDraft = useDiscardWorkspaceDraft();
  const copy = useCallback(
    (value: string, copied: string) => {
      void copyText(value, { copied, failed: "The text was not copied." });
    },
    [copyText],
  );
  return useCallback(
    (entry, action, unread) => {
      const { workspaceId } = entry.workspace;
      const location = sessionEntryLocation(entry);
      switch (action) {
        case "toggle_read":
          setUnread(entry, !unread);
          return;
        case "rename":
          if (entry.context.kind === "workspace") {
            router.push(routes.renameChat(workspaceId, entry.context.session.id));
          }
          return;
        case "archive":
          if (entry.context.kind === "workspace") {
            router.push(routes.archiveChat(workspaceId, entry.context.session.id));
          }
          return;
        case "discard_draft":
          if (entry.context.kind === "workspace_draft") {
            const policy: DraftDiscardPolicy = entry.context.isStarting
              ? "blocked"
              : entry.context.lifecycle === "untouched"
                ? "immediate"
                : "confirm";
            discardDraft(entry.context.draftId, policy);
          }
          return;
        case "copy_working_directory":
          if (location.workingDirectory) {
            copy(location.workingDirectory, "Working directory copied.");
          }
          return;
        case "copy_external_session_id":
          if (location.externalSessionId) {
            copy(location.externalSessionId, "External session ID copied.");
          }
          return;
      }
    },
    [copy, discardDraft, router, setUnread],
  );
};
