import { Archive, Copy, Folder, Mail, MailOpen, Pencil } from "lucide-react";
import { useRef, type ReactElement } from "react";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  useSessionUnread,
  useSetSessionUnread,
} from "@/features/session-navigation/session-read-state";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { useSessionMenu } from "./session-menu-provider";

export function SessionEntryMenu({
  entry,
  onCloseAutoFocus,
}: {
  entry: SessionNavigationEntry;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const openingDialog = useRef(false);
  return (
    <ContextMenuContent
      className="w-56"
      onCloseAutoFocus={(event) => {
        if (openingDialog.current) event.preventDefault();
        else onCloseAutoFocus(event);
        openingDialog.current = false;
      }}
    >
      <SessionMenuItems
        entry={entry}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenDialog={() => {
          openingDialog.current = true;
        }}
      />
    </ContextMenuContent>
  );
}

function SessionMenuItems({
  entry,
  onCloseAutoFocus,
  onOpenDialog,
}: {
  entry: SessionNavigationEntry;
  onCloseAutoFocus: (event: Event) => void;
  onOpenDialog: () => void;
}): ReactElement {
  const unread = useSessionUnread(entry);
  const setUnread = useSetSessionUnread();
  const { requestDialog, copyToClipboard } = useSessionMenu();
  const workspaceSession = entry.context.kind === "workspace" ? entry.context.session : null;
  const identity = entry.target.kind === "task_session" ? entry.target.identity : null;
  const externalSessionId = workspaceSession?.externalSessionId ?? identity?.externalSessionId;
  const workingDirectory =
    workspaceSession?.executionTarget.workingDirectory ?? identity?.workingDirectory;
  const ReadIcon = unread ? MailOpen : Mail;
  const openDialog = (action: "rename" | "archive") => {
    if (!workspaceSession) return;
    onOpenDialog();
    requestDialog({
      action,
      workspace: entry.workspace,
      record: workspaceSession,
      onCloseAutoFocus,
    });
  };
  return (
    <>
      <ContextMenuGroup>
        <ContextMenuItem className="cursor-pointer" onSelect={() => setUnread(entry, !unread)}>
          <ReadIcon aria-hidden="true" />
          {unread ? "Mark as read" : "Mark as unread"}
        </ContextMenuItem>
        {workspaceSession && (
          <ContextMenuItem className="cursor-pointer" onSelect={() => openDialog("rename")}>
            <Pencil aria-hidden="true" />
            Rename session
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          className="cursor-pointer"
          disabled={!workingDirectory}
          onSelect={() => {
            if (workingDirectory) void copyToClipboard(workingDirectory);
          }}
        >
          <Folder aria-hidden="true" />
          Copy working directory
        </ContextMenuItem>
        <ContextMenuItem
          className="cursor-pointer"
          disabled={!externalSessionId}
          onSelect={() => {
            if (externalSessionId) void copyToClipboard(externalSessionId);
          }}
        >
          <Copy aria-hidden="true" />
          Copy external session ID
        </ContextMenuItem>
      </ContextMenuGroup>
      {workspaceSession && (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem className="cursor-pointer" onSelect={() => openDialog("archive")}>
              <Archive aria-hidden="true" />
              Archive session
            </ContextMenuItem>
          </ContextMenuGroup>
        </>
      )}
    </>
  );
}
