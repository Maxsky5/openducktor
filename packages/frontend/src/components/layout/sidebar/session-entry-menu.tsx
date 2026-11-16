import { Archive, Copy, Folder, Mail, MailOpen, Pencil } from "lucide-react";
import { useRef, type ReactElement } from "react";
import { useCommandPaletteCommands } from "@/features/command-palette/command-palette-registry-context";
import { paletteChatKey } from "@/features/command-palette/command-palette-row-keys";
import { ShortcutMenuItem } from "@/features/shortcuts/shortcut-controls";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  useSessionUnread,
  useSetSessionUnread,
} from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { sessionEntryLocation } from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { SESSION_MENU_LABELS } from "@openducktor/frontend-core/workspace-sessions/workspace-session-menu";
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
  const pageCommands = useCommandPaletteCommands();
  const shortcutAvailable = Boolean(
    workspaceSession &&
    pageCommands.some(
      (command) =>
        !command.paletteOnly &&
        command.target?.kind === "chat" &&
        command.target.key === paletteChatKey(entry.workspace.workspaceId, workspaceSession.id),
    ),
  );
  const { externalSessionId, workingDirectory } = sessionEntryLocation(entry);
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
        <ShortcutMenuItem
          shortcutId={shortcutAvailable ? (unread ? "chat-read" : "chat-unread") : undefined}
          className="cursor-pointer"
          onSelect={() => setUnread(entry, !unread)}
        >
          <ReadIcon aria-hidden="true" />
          {unread ? SESSION_MENU_LABELS.markRead : SESSION_MENU_LABELS.markUnread}
        </ShortcutMenuItem>
        {workspaceSession && (
          <ShortcutMenuItem
            shortcutId={shortcutAvailable ? "chat-rename" : undefined}
            className="cursor-pointer"
            onSelect={() => openDialog("rename")}
          >
            <Pencil aria-hidden="true" />
            {SESSION_MENU_LABELS.rename}
          </ShortcutMenuItem>
        )}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ShortcutMenuItem
          shortcutId={shortcutAvailable ? "chat-copy-path" : undefined}
          className="cursor-pointer"
          disabled={!workingDirectory}
          onSelect={() => {
            if (workingDirectory) void copyToClipboard(workingDirectory);
          }}
        >
          <Folder aria-hidden="true" />
          {SESSION_MENU_LABELS.copyWorkingDirectory}
        </ShortcutMenuItem>
        <ShortcutMenuItem
          shortcutId={shortcutAvailable ? "chat-copy-id" : undefined}
          className="cursor-pointer"
          disabled={!externalSessionId}
          onSelect={() => {
            if (externalSessionId) void copyToClipboard(externalSessionId);
          }}
        >
          <Copy aria-hidden="true" />
          {SESSION_MENU_LABELS.copyExternalSessionId}
        </ShortcutMenuItem>
      </ContextMenuGroup>
      {workspaceSession && (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ShortcutMenuItem
              shortcutId={shortcutAvailable ? "chat-archive" : undefined}
              className="cursor-pointer"
              onSelect={() => openDialog("archive")}
            >
              <Archive aria-hidden="true" />
              {SESSION_MENU_LABELS.archive}
            </ShortcutMenuItem>
          </ContextMenuGroup>
        </>
      )}
    </>
  );
}
