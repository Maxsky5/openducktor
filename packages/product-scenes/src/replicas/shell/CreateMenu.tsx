// The menu of the arrow beside New task in session-create-split-action.tsx: a popover with one
// ghost button for each action of the workspace. The label of the issue import names the Git
// provider of the workspace, and New session shows its default shortcut. A scene places the menu
// under the arrow, and `data-hover` shows the item under the pointer.
import { Archive, Download, Import, type LucideIcon, MessageCirclePlus } from "lucide-react";
import type { ReactElement } from "react";
import { type KeyLabels, type KeyPlatform, keyPlatform } from "../keys";
import "./CreateMenu.css";

/** The actions of the menu. A scene finds an item by its action. */
export type CreateAction = "session" | "import-tasks" | "archived" | "import-session";

/**
 * The default shortcut of New session, as shortcutLabel of key-labels.ts writes the control label
 * of the `new-chat` command on each platform.
 */
export const NEW_SESSION_SHORTCUT = {
  mac: "⌃⇧O",
  pc: "Ctrl+Shift+O",
} as const satisfies Record<KeyPlatform, string>;

/** The labels of the menu items that do not depend on the workspace. */
export const CREATE_LABELS = {
  session: "New session",
  archived: "Archived sessions",
  importSession: "Import session from an external runtime",
} as const;

type CreateMenuProps = {
  /** The label of the issue import, such as Import tasks from GitHub Issues. */
  importLabel: string;
  /** The keys of the platform, which give the shortcut of New session. */
  keys: KeyLabels;
};

export function CreateMenu({ importLabel, keys }: CreateMenuProps): ReactElement {
  const items: readonly { action: CreateAction; label: string; Icon: LucideIcon; hint?: string }[] =
    [
      {
        action: "session",
        label: CREATE_LABELS.session,
        Icon: MessageCirclePlus,
        hint: NEW_SESSION_SHORTCUT[keyPlatform(keys)],
      },
      { action: "import-tasks", label: importLabel, Icon: Download },
      { action: "archived", label: CREATE_LABELS.archived, Icon: Archive },
      { action: "import-session", label: CREATE_LABELS.importSession, Icon: Import },
    ];
  return (
    <div className="nc" data-create-menu="">
      {items.map(({ action, label, Icon, hint }) => (
        <span className="nc-item" data-create-item={action} key={action}>
          <Icon />
          <span>{label}</span>
          {hint && <kbd className="nc-hint">{hint}</kbd>}
        </span>
      ))}
    </div>
  );
}
