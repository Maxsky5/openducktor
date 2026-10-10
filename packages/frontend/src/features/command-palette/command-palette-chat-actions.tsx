import { Archive, Copy, Folder, Mail, MailOpen, MessagesSquare, Pencil } from "lucide-react";
import type { ReactElement } from "react";
import type { PaletteChat, PaletteRowAction } from "./command-palette-types";

export type PaletteChatHandlers = {
  open: () => void;
  setUnread: (unread: boolean) => void;
  rename: () => void;
  archive: () => void;
  copy: (value: string) => void;
};

/** The action list of a chat: Open chat, then the actions of its sidebar menu. */
export const paletteChatActions = (
  chat: PaletteChat,
  unread: boolean,
  handlers: PaletteChatHandlers,
): PaletteRowAction[] => {
  const { session } = chat;
  return [
    chatAction("open", "Open chat", <MessagesSquare />, ["resume", "go to"], handlers.open),
    unread
      ? chatAction("read-state", "Mark as read", <MailOpen />, ["read", "seen"], () =>
          handlers.setUnread(false),
        )
      : chatAction("read-state", "Mark as unread", <Mail />, ["unread", "later"], () =>
          handlers.setUnread(true),
        ),
    chatAction("rename", "Rename chat", <Pencil />, ["title", "name"], handlers.rename),
    copyAction(
      "copy-working-directory",
      "Copy working directory",
      <Folder />,
      ["path", "folder", "worktree", "clipboard"],
      session.executionTarget.workingDirectory,
      handlers.copy,
    ),
    copyAction(
      "copy-external-session-id",
      "Copy external session ID",
      <Copy />,
      ["runtime", "id", "clipboard"],
      session.externalSessionId,
      handlers.copy,
    ),
    {
      ...chatAction("archive", "Archive chat", <Archive />, ["remove", "hide"], handlers.archive),
      destructive: true,
    },
  ];
};

const chatAction = (
  key: string,
  label: string,
  icon: ReactElement,
  keywords: readonly string[],
  run: () => void,
): PaletteRowAction => ({ key, label, keywords, icon, destructive: false, disabled: false, run });

/** A copy action. A chat without the value shows it disabled, as the sidebar menu does. */
const copyAction = (
  key: string,
  label: string,
  icon: ReactElement,
  keywords: readonly string[],
  value: string | null,
  copy: (value: string) => void,
): PaletteRowAction => ({
  ...chatAction(key, label, icon, keywords, () => {
    if (value !== null) copy(value);
  }),
  disabled: value === null,
});
