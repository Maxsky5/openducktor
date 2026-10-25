import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { useSetSessionUnread } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { routes } from "@/navigation/routes";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { sessionEntryLocation } from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
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
    [copy, router, setUnread],
  );
};
